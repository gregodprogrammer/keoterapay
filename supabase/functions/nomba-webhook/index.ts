// supabase/functions/nomba-webhook/index.ts
//
// Edge Function: nomba-webhook
// Public URL, registered on Nomba's dashboard (Dashboard → Developer → Webhook Setup).
//
// Responsibilities:
//   1. Verify the nomba-signature header (HMAC-SHA256) before trusting ANYTHING
//      in the payload.
//   2. On payment_success with tokenizedCardData.tokenKey: upsert into payment_methods,
//      and if this was a recurring charge (not first payment), update the matching
//      charges row to 'successful'.
//   3. On payment_failed: update the matching charges row to 'failed', set the
//      subscription status to 'past_due'.
//   4. Return 2XX FAST. Don't do slow work in here — Nomba retries up to 5x with
//      exponential backoff on any non-2XX response.
//
// IMPORTANT: this function intentionally does NOT use the Supabase client's auth
// helpers for the incoming request — Nomba is not a logged-in user. We use
// supabaseAdmin (service_role) directly, since signature verification is what
// proves the request is legitimate, not a Supabase session.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOMBA_WEBHOOK_SECRET = Deno.env.get("NOMBA_WEBHOOK_SECRET")!; // signature key from Nomba dashboard

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Signature verification — exact algorithm from Nomba's API reference.
// DO NOT trust any payload that fails this check.
// ---------------------------------------------------------------------------

async function verifySignature(
  payload: any,
  secret: string,
  timestamp: string,
  signatureValue: string,
): Promise<boolean> {
  const { event_type, requestId, data } = payload;
  const { merchant, transaction } = data;

  let responseCode = transaction?.responseCode || "";
  if (responseCode === "null") responseCode = "";

  const hashingPayload = [
    event_type,
    requestId,
    merchant?.userId,
    merchant?.walletId,
    transaction?.transactionId,
    transaction?.type,
    transaction?.time,
    responseCode,
    timestamp,
  ].join(":");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(hashingPayload),
  );

  const mySig = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

  return mySig.toLowerCase() === signatureValue.toLowerCase();
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handlePaymentSuccess(data: any) {
  const { order, tokenizedCardData, transaction } = data;
  const orderReference = order?.orderReference;
  const customerId = order?.customerId; // this is the Supabase auth.users.id we sent as customerId

  // Case A: this is the FIRST payment (tokenization) — save the card.
  if (tokenizedCardData?.tokenKey) {
    const { error: pmError } = await supabaseAdmin
      .from("payment_methods")
      .insert({
        customer_id: customerId,
        token_key: tokenizedCardData.tokenKey,
        card_type: tokenizedCardData.cardType || null,
        card_last4: tokenizedCardData.cardPan
          ? tokenizedCardData.cardPan.slice(-4)
          : null,
        is_active: true,
      });

    if (pmError) {
      console.error("Failed to save payment_method:", pmError.message);
      // Still return 2XX below — Nomba doesn't need to retry for our DB issue,
      // but log loudly so this doesn't get missed.
    } else {
      console.log(`Saved new payment method for customer ${customerId}`);
    }
  }

  // Case B: this is a RECURRING charge confirming success — update the
  // matching charges row (created as 'pending' by charge-subscriptions).
  if (orderReference) {
    const { error: chargeError } = await supabaseAdmin
      .from("charges")
      .update({
        status: "successful",
        nomba_transaction_id: transaction?.transactionId || null,
      })
      .eq("order_reference", orderReference)
      .eq("status", "pending"); // only update if still pending — avoid clobbering

    if (chargeError) {
      console.error("Failed to update charge to successful:", chargeError.message);
    }
  }
}

async function handlePaymentFailed(data: any) {
  const { order, transaction } = data;
  const orderReference = order?.orderReference;

  if (!orderReference) {
    console.error("payment_failed event with no orderReference, cannot match a charge");
    return;
  }

  const { data: charge, error: fetchError } = await supabaseAdmin
    .from("charges")
    .select("id, subscription_id")
    .eq("order_reference", orderReference)
    .maybeSingle();

  if (fetchError || !charge) {
    console.error("Could not find matching charge for failed payment:", orderReference);
    return;
  }

  await supabaseAdmin
    .from("charges")
    .update({
      status: "failed",
      failure_reason: transaction?.responseCode || "unknown",
    })
    .eq("id", charge.id);

  if (charge.subscription_id) {
    await supabaseAdmin
      .from("subscriptions")
      .update({ status: "past_due" })
      .eq("id", charge.subscription_id);
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read the raw body ONCE — needed both for signature verification and
  // for parsing. Don't call req.json() and then re-stringify; use the same
  // parsed object consistently.
  const rawBody = await req.text();
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("Webhook payload was not valid JSON");
    return new Response("Invalid payload", { status: 400 });
  }

  const signatureValue = req.headers.get("nomba-signature");
  const timestamp = req.headers.get("nomba-timestamp");

  if (!signatureValue || !timestamp) {
    console.error("Missing nomba-signature or nomba-timestamp header");
    return new Response("Missing signature headers", { status: 400 });
  }

  const isValid = await verifySignature(
    payload,
    NOMBA_WEBHOOK_SECRET,
    timestamp,
    signatureValue,
  );

  if (!isValid) {
    console.error("Webhook signature verification FAILED — rejecting payload");
    // Return 400, not 401 — Nomba's retry logic treats non-2XX as "try again",
    // a persistently invalid signature will just keep failing, which is correct
    // (we never want to process an unverified payload).
    return new Response("Invalid signature", { status: 400 });
  }

  // Signature confirmed valid — now safe to act on the payload.
  try {
    switch (payload.event_type) {
      case "payment_success":
        await handlePaymentSuccess(payload.data);
        break;
      case "payment_failed":
        await handlePaymentFailed(payload.data);
        break;
      // payment_reversal, payout_success, payout_failed, payout_refund:
      // not required for the Checkout/Recurring track demo. Log and
      // acknowledge so Nomba doesn't retry, but no DB action needed yet.
      default:
        console.log(`Received unhandled event_type: ${payload.event_type}`);
    }
  } catch (err) {
    // Even if our handler throws, log it but still return 2XX below if the
    // signature was valid and we don't want Nomba retrying a payload our
    // own code can't process anyway. Adjust this tradeoff if you'd rather
    // retry on internal errors.
    console.error("Error processing webhook event:", err);
  }

  // Return 2XX FAST — required to avoid Nomba's retry/backoff cycle.
  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
