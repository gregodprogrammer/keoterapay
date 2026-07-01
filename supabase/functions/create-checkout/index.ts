// supabase/functions/create-checkout/index.ts
//
// Edge Function: create-checkout
// Called from the frontend when a customer starts checkout (first payment +
// card tokenization for future recurring charges).
//
// Responsibilities:
//   1. Get a valid Nomba access token (from cache, refreshing if expired)
//   2. Call POST /v1/checkout/order with tokenizeCard: true
//   3. Return { checkoutLink, orderReference } to the frontend
//
// This function does NOT save the card token — that happens later, when the
// nomba-webhook function receives the payment_success event with
// tokenizedCardData.tokenKey. This function only kicks off the checkout.

import { createClient } from "jsr:@supabase/supabase-js@2";

const NOMBA_BASE_URL = Deno.env.get("NOMBA_BASE_URL") || "https://sandbox.nomba.com";
const NOMBA_CLIENT_ID = Deno.env.get("NOMBA_CLIENT_ID")!;
const NOMBA_CLIENT_SECRET = Deno.env.get("NOMBA_CLIENT_SECRET")!;
const NOMBA_ACCOUNT_ID = Deno.env.get("NOMBA_ACCOUNT_ID")!;
const CALLBACK_URL = Deno.env.get("CHECKOUT_CALLBACK_URL")!; // must be HTTPS

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Single shared admin client — bypasses RLS, used only server-side in this function.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Token cache helpers
// ---------------------------------------------------------------------------

interface NombaTokenRow {
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

async function getCachedToken(): Promise<NombaTokenRow | null> {
  const { data, error } = await supabaseAdmin
    .from("nomba_auth_cache")
    .select("access_token, refresh_token, expires_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("Failed to read nomba_auth_cache:", error.message);
    return null;
  }
  return data;
}

async function issueNewToken(): Promise<{ access_token: string; refresh_token: string; expires_at: string }> {
  const res = await fetch(`${NOMBA_BASE_URL}/v1/auth/token/issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accountId: NOMBA_ACCOUNT_ID,
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: NOMBA_CLIENT_ID,
      client_secret: NOMBA_CLIENT_SECRET,
    }),
  });

  const json = await res.json();

  if (json.code !== "00") {
    throw new Error(`Nomba token issue failed: ${json.description || "unknown error"}`);
  }

  const { access_token, refresh_token, expiresAt } = json.data;
  return { access_token, refresh_token, expires_at: expiresAt };
}

async function saveTokenToCache(token: { access_token: string; refresh_token: string; expires_at: string }) {
  const { error } = await supabaseAdmin
    .from("nomba_auth_cache")
    .upsert({
      id: 1,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: token.expires_at,
    });

  if (error) {
    // Not fatal — we still have the token in memory for this request.
    console.error("Failed to save token to cache:", error.message);
  }
}

/**
 * Returns a valid Nomba access token, refreshing/re-issuing if the cached
 * one is missing or about to expire (5 min buffer, per the API reference).
 */
async function getValidNombaToken(): Promise<string> {
  const cached = await getCachedToken();

  if (cached?.access_token && cached.expires_at) {
    const expiresAt = new Date(cached.expires_at).getTime();
    const fiveMinutesMs = 5 * 60 * 1000;
    const stillValid = expiresAt - fiveMinutesMs > Date.now();

    if (stillValid) {
      return cached.access_token;
    }
  }

  // No cached token, or it's expired/about to expire — issue a fresh one.
  // (Using a fresh client_credentials issue rather than the refresh endpoint
  // for simplicity in Phase 1 — both work; refresh-token flow is a Phase 2
  // refinement if you want to minimize full re-auth calls.)
  const fresh = await issueNewToken();
  await saveTokenToCache(fresh);
  return fresh.access_token;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    // Identify the calling user from their Supabase JWT (frontend sends
    // Authorization: Bearer <user_access_token> automatically when using
    // the Supabase client).
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired session" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { amount, planId } = body;

    if (!amount) {
      return new Response(JSON.stringify({ error: "amount is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessToken = await getValidNombaToken();

    // orderReference must be unique per merchant — uuid v4 via crypto.randomUUID()
    const orderReference = crypto.randomUUID();

    const checkoutRes = await fetch(`${NOMBA_BASE_URL}/v1/checkout/order`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        accountId: NOMBA_ACCOUNT_ID,
      },
      body: JSON.stringify({
        order: {
          amount: String(amount), // Nomba expects amount as a string, e.g. "10000.00"
          currency: "NGN",
          orderReference,
          callbackUrl: CALLBACK_URL,
          customerEmail: user.email,
          customerId: user.id,
        },
        tokenizeCard: true,
      }),
    });

    const checkoutJson = await checkoutRes.json();

    if (checkoutJson.code !== "00") {
      console.error("Nomba checkout order failed:", checkoutJson);
      return new Response(
        JSON.stringify({ error: checkoutJson.description || "Checkout creation failed" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Optional: if planId was provided, you could pre-create a 'pending'
    // subscription row here keyed by orderReference, so the webhook has
    // something to attach the payment_method/subscription to once the
    // tokenKey arrives. Left as a Phase 1 decision point — simplest path
    // for a hackathon demo is to create the subscription row in the
    // webhook handler itself once you have the tokenKey, customer_id,
    // and planId together. Adjust based on how your frontend passes planId.

    return new Response(
      JSON.stringify({
        checkoutLink: checkoutJson.data.checkoutLink,
        orderReference: checkoutJson.data.orderReference,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (err) {
    console.error("create-checkout error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
