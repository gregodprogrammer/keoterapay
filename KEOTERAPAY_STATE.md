# KeoteraPay — Project State File
# READ THIS FIRST IN ANY NEW SESSION, REGARDLESS OF MODEL OR INTERFACE.
# Last updated: 2026-07-01

---

## WHO YOU ARE AND WHAT THIS PROJECT IS

You are a contributor on the KeoteraPay project. The team lead is Greg Chibuzor Odi.
This is a recurring billing platform built on Supabase + Nomba API, submitted to the
DevCareer x Nomba Hackathon 2026 (Track: Checkout, Recurring). Application name: KeoteraPay.
Supabase project ref: gaivftcuqhlffwzdnljv. Repo: ~/nomba-checkout.

---

## MANDATORY GUARDRAILS — NON-NEGOTIABLE

1. Nothing is "done" until the team lead explicitly confirms it with real evidence reviewed.
2. Every claim must be backed by actual command output, query results, or API responses.
   Never describe what "should" happen — show what actually happened.
3. One step at a time. Present, stop, wait for confirmation before the next step.
4. Present steps in this exact format:
   STEP: [name]
   WHAT I DID: [exact actions]
   EVIDENCE: [actual real output]
   WAITING FOR YOUR CONFIRMATION TO PROCEED.
5. Team lead can overwrite, skip, or reorder any step at any time.
6. When pasting file contents for review: use chunks of ≤20 lines, wait between each.
   Long pastes have caused corruption issues on this project before — avoid them.
7. Flag discrepancies between docs and live behavior immediately. Never silently fix them.
8. Update PROGRESS_TRACKER.md as you go, but show the diff before saving it.

---

## HARD SCOPE LOCKS — DO NOT TOUCH THESE

- supabase/migrations/20260626000000_add_mandates_and_profiles.sql
  EXISTS on disk. NOT reviewed. NOT run against any database. DO NOT RUN IT.
  DO NOT modify it. Leave it exactly as it is.
- Direct Debit / Mandates work is OUT OF SCOPE until after July 3rd deadline.
  Do not write any mandate-related code.
- Admin panel / admin-trigger-charge / is_admin: OUT OF SCOPE for the MVP.
- Do not re-run pg_cron. It was deliberately unscheduled. Do not reschedule it.

---

## WHAT IS CONFIRMED DONE (do not redo, do not re-verify)

All three Edge Functions deployed and live-verified against real Nomba sandbox:

| File | Status | Key evidence |
|---|---|---|
| supabase/functions/create-checkout/index.ts | ✅ Deployed | Real checkoutLink returned, sandbox page loaded visually |
| supabase/functions/nomba-webhook/index.ts | ✅ Deployed, reachable | curl returns 405 (correct), verify_jwt=false confirmed |
| supabase/functions/charge-subscriptions/index.ts | ✅ Deployed, secured | Correct secret→200, wrong secret→401, real trigger tested |
| supabase/config.toml | ✅ In place | verify_jwt=false for nomba-webhook and charge-subscriptions |
| schema.sql | ✅ Approved baseline | Docker Postgres test passed, 5 tables confirmed, SHA-256: a335d78f133d9510fe111386fcaddd861f27bc8a1e192944b833422a063603af |

Database: 5 tables live with RLS (plans, payment_methods, subscriptions, charges, nomba_auth_cache).
Supabase uses NEW key format: publishable (sb_publishable_...) and secret (sb_secret_...).
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into Edge Functions — do NOT set them as secrets.

---

## WHAT IS STILL OPEN (genuinely incomplete)

1. WEBHOOK SIGNATURE — not yet verified against a real delivered payload.
   Still blocked on Nomba sandbox authorization (Google Form submitted, no response).
   Plan: switch to production credentials for one real ₦100 test payment.
   This is the LAST remaining backend piece.

2. PRODUCTION WEBHOOK TEST — one real payment on production to confirm:
   - Real payment_success event arrives at the webhook URL
   - Signature verification works against real payload
   - Real tokenKey gets written to payment_methods
   Credentials: team lead has production client_id, client_secret, accountId.
   Amount: ₦100 (safe above any unstated minimum, fee ≈ ₦1.40).
   Requires: update NOMBA_BASE_URL to https://api.nomba.com, set production credentials
   as Supabase secrets, register webhook URL on production Nomba dashboard.

3. FRONTEND — not started. See claude-code-frontend-brief.md for full spec.
   This is the current active priority — deadline July 3rd 11:59 PM GMT+1.

---

## REAL API FINDINGS — DO NOT CONTRADICT THESE WITHOUT LIVE EVIDENCE

| Finding | Confirmed value |
|---|---|
| Sandbox URL | https://sandbox.nomba.com (sandbox.api.nomba.com = NXDOMAIN) |
| Production URL | https://api.nomba.com |
| Token lifetime | ~3 hours (not 30min as docs say, not 60min as training says) |
| Checkout amount format | Decimal string "100.00" (not kobo integer) |
| Checkout response link field | checkoutLink (not checkoutUrl) |
| Nomba's orderReference | Nomba returns its OWN value, different from what you send — treat theirs as canonical |
| Recurring charge success | code:"00" only means accepted, NOT confirmed — webhook confirms |
| Webhook signature | Colon-joined fields, HMAC-SHA256, base64. Confirmed from 4 independent sources. |
| No mandate webhook | Mandate events do NOT exist in Nomba's webhook system — poll status instead |
| Supabase JWT gate | verify_jwt=false required for webhook + cron functions or they silently 401 |

---

## WHAT TO DO FIRST IN ANY NEW SESSION

1. Read this file fully.
2. Read PROGRESS_TRACKER.md "Where We Stopped" and "Completion log" sections.
3. Read claude-code-frontend-brief.md if working on frontend.
4. Confirm you understand the scope locks and guardrails.
5. Propose only the single next step. Wait for approval before touching anything.

Do not assume, infer, or proceed without confirmation.
The team lead is the only person who can say a step is done.
