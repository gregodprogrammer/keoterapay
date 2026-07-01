// supabase/functions/charge-subscriptions/index.ts
//
// Edge Function: charge-subscriptions
// Triggered two ways:
//   1. pg_cron, on a schedule (see schema.sql bottom section)
//   2. A manual "Trigger charge now" button in the dashboard UI — demo safety,
//      so the live demo never depends on cron timing during judging.
//
// Responsibilities:
//   1. Find every subscription that is due: status = 'active' AND next_charge_at <= now()
//   2. For each due subscription:
//        a. Look up its saved payment_method (token_key)
//        b. Generate a fresh, unique order_reference
//        c. Insert a 'pending' row into charges FIRST (so there's an audit
//           trail even if the Nomba call itself fails or times out)
//        d. Call POST /v1/checkout/tokenized-card-payment with the saved tokenKey
//        e. Advance next_charge_at based on the plan's interval
//   3. Return a summary of what was attempted.
//
// IMPORTANT — this function does NOT wait for a webhook to confirm anything.
// It only *triggers* charges. nomba-webhook is what flips a charge from
// 'pending' to 'successful' or 'failed' when Nomba's async event arrives.
// This split is deliberate: cron jobs that block on slow external calls per
// row are exactly the kind of thing that times out and silently drops work
// under load. Trigger-and-move-on, let the webhook reconcile.
//
// IDEMPOTENCY NOTE: order_reference has a UNIQUE constraint at the DB level
// (see schema.sql). If this function is accidentally invoked twice for the
// same due subscription before next_charge_at advances (e.g. cron overlap,
// or someone mashing the manual trigger button), the second insert into
// charges will fail on the unique constraint and that subscription's second
// attempt is skipped — not double-charged. This is the same protection
// flagged in nomba-api-reference.md section 7.2.

import { createClient } from "jsr:@supabase/supabase-js@2";

const NOMBA_BASE_URL = Deno.env.get("NOMBA_BASE_URL") || "https://sandbox.nomba.com";
const NOMBA_CLIENT_ID = Deno.env.get("NOMBA_CLIENT_ID")!;
const NOMBA_CLIENT_SECRET = Deno.env.get("NOMBA_CLIENT_SECRET")!;
const NOMBA_ACCOUNT_ID = Deno.env.get("NOMBA_ACCOUNT_ID")!;
const CALLBACK_URL = Deno.env.get("CHECKOUT_CALLBACK_URL")!; // must be HTTPS

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// This function is invoked by pg_cron / a server-side button, never directly
// by a customer's browser — so it uses the service_role client throughout.
// There is no end-user JWT to validate here, unlike create-checkout.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Token cache helpers — identical pattern to create-checkout.ts, duplicated
// rather than shared because these are two independent Edge Functions with
// no shared module bundle in this hackathon's setup. (Phase 2 refinement:
// extract to a shared _shared/nomba-auth.ts once both functions are stable.)
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
    console.error("Failed to save token to cache:", error.message);
  }
}

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

  const fresh = await issueNewToken();
  await saveTokenToCache(fresh);
  return fresh.access_token;
}

// ---------------------------------------------------------------------------
// Interval math — how far to push next_charge_at forward after a successful
// trigger. Kept simple and explicit (no date-fns dependency) since the only
// three values allowed by the plans table's CHECK constraint are these.
// ---------------------------------------------------------------------------

function advanceByInterval(from: Date, interval: string): Date {
  const next = new Date(from);
  switch (interval) {
    case "daily":
      next.setUTCDate(next.getUTCDate() + 1);
      break;
    case "weekly":
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case "monthly":
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
    default:
      throw new Error(`Unknown plan interval: ${interval}`);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Row shape returned by the due-subscriptions query (joined with plan +
// payment_method so we have everything needed in one round trip).
// ---------------------------------------------------------------------------

interface DueSubscriptionRow {
  id: string;
  customer_id: string;
  next_charge_at: string;
  plans: { id: string; amount: number; currency: string; interval: string } | null;
  payment_methods: { id: string; token_key: string; is_active: boolean } | null;
}

// ---------------------------------------------------------------------------
// Per-subscription charge attempt. Each subscription is handled
// independently and wrapped so one failure never aborts the batch.
// ---------------------------------------------------------------------------

async function attemptCharge(
  sub: DueSubscriptionRow,
  accessToken: string,
): Promise<{ subscriptionId: string; outcome: string; detail?: string }> {
  const plan = sub.plans;
  const paymentMethod = sub.payment_methods;

  if (!plan) {
    return { subscriptionId: sub.id, outcome: "skipped", detail: "no linked plan found" };
  }
  if (!paymentMethod || !paymentMethod.is_active || !paymentMethod.token_key) {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "past_due" })
      .eq("id", sub.id);
    return { subscriptionId: sub.id, outcome: "skipped", detail: "no active payment method" };
  }

  const orderReference = crypto.randomUUID();

  const { error: insertError } = await supabaseAdmin.from("charges").insert({
    subscription_id: sub.id,
    order_reference: orderReference,
    amount: plan.amount,
    status: "pending",
  });

  if (insertError) {
    return {
      subscriptionId: sub.id,
      outcome: "skipped",
      detail: `could not insert pending charge: ${insertError.message}`,
    };
  }

  try {
    const chargeRes = await fetch(`${NOMBA_BASE_URL}/v1/checkout/tokenized-card-payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        accountId: NOMBA_ACCOUNT_ID,
      },
      body: JSON.stringify({
        order: {
          orderReference,
          customerId: sub.customer_id,
          callbackUrl: CALLBACK_URL,
          amount: String(plan.amount),
          currency: plan.currency,
          accountId: NOMBA_ACCOUNT_ID,
        },
        tokenKey: paymentMethod.token_key,
      }),
    });

    const chargeJson = await chargeRes.json();

    if (chargeJson.code !== "00") {
      await supabaseAdmin
        .from("charges")
        .update({
          status: "failed",
          failure_reason: chargeJson.description || "tokenized-card-payment rejected",
        })
        .eq("order_reference", orderReference);

      await supabaseAdmin
        .from("subscriptions")
        .update({ status: "past_due" })
        .eq("id", sub.id);

      return {
        subscriptionId: sub.id,
        outcome: "failed",
        detail: chargeJson.description || "rejected by Nomba",
      };
    }

    const nextChargeAt = advanceByInterval(new Date(sub.next_charge_at), plan.interval);
    await supabaseAdmin
      .from("subscriptions")
      .update({ next_charge_at: nextChargeAt.toISOString() })
      .eq("id", sub.id);

    return { subscriptionId: sub.id, outcome: "triggered", detail: orderReference };
  } catch (err) {
    console.error(`Network error charging subscription ${sub.id}:`, err);
    return {
      subscriptionId: sub.id,
      outcome: "error",
      detail: err instanceof Error ? err.message : "unknown network error",
    };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
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

  // Platform-level JWT verification is disabled for this function (see
  // supabase/config.toml — verify_jwt = false), the same way nomba-webhook
  // is configured, because pg_cron and a server-side "trigger now" button
  // are not logged-in Supabase users and have no user JWT to send. Since the
  // platform gate is off, THIS check is now the only thing standing between
  // this function and anyone on the internet who finds the URL — so it is
  // mandatory, not optional. CRON_SECRET is a value we generate ourselves
  // (see PROGRESS_TRACKER.md), unrelated to any Supabase or Nomba key.
  const CRON_SECRET = Deno.env.get("CRON_SECRET")!;
  const authHeader = req.headers.get("Authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    console.error("charge-subscriptions: rejected call with invalid/missing CRON_SECRET");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // This function is called by pg_cron (with the service_role key as a
  // bearer token, per schema.sql's net.http_post example) or by the
  // dashboard's manual "Trigger charge now" button. Either way, the caller
  // is trusted infrastructure, not an arbitrary end user.

  try {
    const nowIso = new Date().toISOString();

    const { data: dueSubscriptions, error: queryError } = await supabaseAdmin
      .from("subscriptions")
      .select(
        `
        id,
        customer_id,
        next_charge_at,
        plans ( id, amount, currency, interval ),
        payment_methods ( id, token_key, is_active )
      `,
      )
      .eq("status", "active")
      .lte("next_charge_at", nowIso);

    if (queryError) {
      console.error("Failed to query due subscriptions:", queryError.message);
      return new Response(JSON.stringify({ error: "Failed to query subscriptions" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!dueSubscriptions || dueSubscriptions.length === 0) {
      return new Response(
        JSON.stringify({ message: "No subscriptions due", attempted: 0, results: [] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const accessToken = await getValidNombaToken();

    const results = [];
    for (const row of dueSubscriptions as unknown as DueSubscriptionRow[]) {
      const result = await attemptCharge(row, accessToken);
      results.push(result);
    }

    return new Response(
      JSON.stringify({
        message: "Charge run complete",
        attempted: results.length,
        results,
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
    console.error("charge-subscriptions error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
