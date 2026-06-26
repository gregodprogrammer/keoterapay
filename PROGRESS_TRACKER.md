# Nomba Checkout & Recurring — Deploy Guide & Progress Tracker

**Origin:** Nomba Solutions hackathon (via DevCareer x Nomba Hackathon 2026) — Track: Checkout, Recurring
**Current scope:** No longer hackathon-only. Building this as the real foundation for a fintech product. Correctness, security, and architecture take priority over speed.
**Stack:** Supabase (Postgres + Auth + Edge Functions + pg_cron) · Nomba API · React frontend (not yet built — see Phase 6)
**Application name (idea submission):** KeoteraPay

> This file is two things at once:
> 1. A **step-by-step deploy guide** — follow it top to bottom on a clean machine and you'll reproduce the whole project with no guessing.
> 2. A **living progress log** — update the checkboxes and the Challenges Log as you go, so anyone (including future-you) can see exactly where the project stopped and why.

This is a **fully separate project** — new `auth.users`, new repo, new credentials, nothing shared with any prior project.

---

## Team workflow & approval guardrails (read this before doing anything)

This project is now a team effort: the team lead (project owner) plus contributors, which currently includes Claude Code working directly in the repo. The following rules apply to everyone, including any AI assistant working on this project:

1. **Nothing is "done" until the team lead explicitly confirms it.** A contributor's own confidence that something works is not completion — only the team lead's literal "okay," "confirmed," "approved," or equivalent counts.
2. **Every claim of completion must come with real, live evidence** — actual terminal output, actual query results, actual API responses — never a description of what "should" happen.
3. **Work is reviewed one step at a time, not in batches.** Present one step, wait for confirmation, then move to the next.
4. **The team lead can overwrite, skip, or reorder any step at any time** — this tracker is a living plan, not a fixed contract.
5. **Known-open items stay visibly open until the team lead says otherwise** — nobody (human or AI) marks a blocked item resolved without explicit confirmation that it was actually tested and confirmed.
6. **Genuine discrepancies between docs/specs/training material and live sandbox behavior get flagged explicitly, never silently "fixed."** The live sandbox is the technical authority; the team lead decides what to do about any conflict.

This section exists so that as the project grows beyond a single contributor, nobody — including the project owner returning after time away — has to wonder what's actually finished versus claimed-finished.

---

## Where We Stopped
---

## Completion log — what the team lead has actually approved, and when

This is the audit trail. Every entry here represents a step that was presented with real evidence and explicitly approved by the team lead. Nothing goes in this table on the basis of a contributor's own claim — only on the team lead's confirmation. New entries get added at the top (most recent first). If a step is presented but NOT yet approved, it does not belong in this table — it stays listed as open/pending in the relevant phase section above instead.

| Date | Step approved | Approved by | Evidence reviewed |
|---|---|---|---|
| 2026-06-25 | pg_cron scheduled, fired 3+ times every 60s, all `status: succeeded`, then deliberately unscheduled | Team lead | Screenshot of `cron.job_run_details` query results; screenshot of `unschedule: true` |
| 2026-06-25 | `charge-subscriptions` secured with `CRON_SECRET`; correct secret → 200 success, wrong secret → 401 Unauthorized | Team lead | Pasted terminal output of both the correct-secret and wrong-secret curl tests |
| 2026-06-25 | Seeded test subscription triggered for real; `charges` row correctly stayed `pending` with a fake token (proves trigger ≠ confirm architecture holds) | Team lead | Screenshot of SQL query result showing `status: pending`, `nomba_transaction_id: NULL` |
| 2026-06-25 | `nomba-webhook` deployed and reachable; `verify_jwt = false` fix confirmed working | Team lead | Pasted curl output showing `405 Method not allowed` (after initially getting `401`) |
| 2026-06-25 | `create-checkout` fully verified end-to-end, including visual confirmation of the real Nomba sandbox checkout page | Team lead | Pasted JSON response with real `checkoutLink`; screenshot of the rendered Nomba payment page showing "Pay ₦1,000" |
| 2026-06-25 | Database schema (5 tables) + RLS deployed | Team lead | Screenshot of Table Editor showing all 5 tables; screenshot showing "1 RLS policy" badge |

**Still open, NOT in this log because not yet approved (or not yet attempted):**
- Webhook signature verified against a real delivered payload — blocked on Nomba's sandbox authorization
- Real sandbox test payment succeeding (last attempt failed at PIN step, root cause unconfirmed)
- Direct Debit Mandate integration — brief handed to Claude Code, no steps approved yet
- React frontend — brief handed to Claude Code, no steps approved yet
- Reconciliation job for stuck-`pending` charges — not yet built

---

## Live API Findings — Confirmed via real sandbox testing

These were reconciled against **three sources that disagreed** with each other: an older cached API reference, a third-party certification training course, and the real live docs at developer.nomba.com — then settled with actual live curl tests against the sandbox.

| Question | Old reference doc | Training course | Live docs / live test | **Verdict** |
|---|---|---|---|---|
| Sandbox base URL | `sandbox.nomba.com` | `sandbox.api.nomba.com` (confirmed NXDOMAIN via 2 resolvers — does not exist) | `sandbox.nomba.com` (confirmed live, HTTP 200, real token issued) | **`https://sandbox.nomba.com`** |
| Token field names | `access_token`, `refresh_token`, `expiresAt`, `code: "00"` | same | **Confirmed live**, exact match, plus `businessId` | Old reference doc was right |
| Token lifetime | 30 minutes | 60 minutes | **Confirmed live: 3 hours** (issued 09:13:52 → expires 12:13:52 same day) | Neither doc was right — observed value used in code |
| Checkout endpoint + amount format | `/v1/checkout/order`, decimal string `"1000.00"` | same endpoint, integer kobo | **Confirmed live: decimal string accepted, real checkoutLink returned** | Old reference doc was right |
| Checkout response link field | `checkoutLink` | `checkoutUrl` | **Confirmed live: `checkoutLink`** | Old reference doc was right |
| Checkout response reference | Assumed echoes back your `orderReference` | n/a | **Confirmed live: Nomba returns its OWN `orderReference`, different from the one sent** | New finding, not in either doc — Nomba's returned value is canonical |
| Recurring charge endpoint + fields | `/v1/checkout/tokenized-card-payment`, `tokenKey` | `/tokenized-card/charge`, `cardId` | Live API reference nav confirms old doc's path and field name | Old reference doc was right |
| Webhook signature scheme | Colon-joined fields, HMAC-SHA256, base64 | Plain HMAC-SHA256 over raw body, hex | Live signature-verification page Go sample matches colon-joined/base64 | Old reference doc was right — **still not tested against a real delivered webhook** |
| Headers required | `Authorization: Bearer`, `accountId` | same | Confirmed live | Agreed |
| Parent vs sub-account ID | n/a | n/a | **Confirmed live: parent `accountId` alone sufficient for auth + checkout + recurring charge trigger.** Sub-account ID's exact use still undetermined. | Open — see AMA questions doc |
| Test PINs (new finding) | n/a | n/a | Sandbox checkout PIN screen states: `1234`, `0000`, `1111`, or `5555` | New finding, not in any prior doc |
| Tokenized-card-payment with fake token | n/a | n/a | **Returns `code: "00"` (accepted) even with a placeholder token_key** — does NOT mean payment succeeded, only that the request was accepted for async processing | Critical finding — confirms our architecture's deliberate choice to never mark a charge `successful` synchronously; only the webhook may do that |
| Direct Debit mandate creation response | n/a | `/v1/mandates/*` | Real OpenAPI spec confirms `/v1/direct-debits`, uses `responseCode`/`responseMessage` envelope (not `code`/`description`) | New finding — confirmed from live OpenAPI spec, not inferred |
| Direct Debit mandate debit response | n/a | n/a | Real OpenAPI spec confirms `/v1/direct-debits/debit-mandate`, uses `code`/`description`/`status` envelope — different from creation endpoint | New finding — two mandate endpoints use genuinely different response shapes |
| Mandate webhook events | n/a | n/a | **CONFIRMED: no mandate-specific webhook event exists.** Only 6 events total: payment_success, payout_success, payment_failed, payment_reversal, payout_failed, payout_refund | Critical finding — mandate status must be polled via GET /v1/direct-debits/status, never delivered via webhook |

**Bottom line:** the original `create-checkout.ts`, `nomba-webhook.ts`, and `charge-subscriptions/index.ts` (all written before the training course existed) have now been proven correct against the real, live sandbox on every point that mattered, including under real load (a real test subscription, a real triggered charge).

---

## Phase 0 — Prerequisites & Accounts — ✅ Complete

| # | Task | Status |
|---|---|---|
| 0.1–0.9 | Supabase account, project (`nomba-checkout-recurring`, ref `gaivftcuqhlffwzdnljv`, Frankfurt), CLI (v2.107.0, project-local via `npm install -D supabase`), Nomba sandbox credentials, git repo (`~/nomba-checkout`) | ✅ All done |

**Key naming/credential facts confirmed today:**
- Supabase project uses the **new key system**: `publishable` (`sb_publishable_...`) and `secret` (`sb_secret_...`) — not legacy `anon`/`service_role`. Functionally equivalent; `secret` was used wherever `service_role` is referenced in older docs/code comments.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** into every Edge Function — the CLI actively blocks manually setting them (`Env name cannot start with SUPABASE_`). This is correct, intentional behavior.

---

## Phase 1 — Database: Schema + RLS — ✅ Complete

All 5 tables (`plans`, `payment_methods`, `subscriptions`, `charges`, `nomba_auth_cache`) created, RLS confirmed enabled (visible as "1 RLS policy" badge in Table Editor for `payment_methods`).

**Still outstanding:** explicit cross-user row isolation test (insert two fake rows under different `customer_id`s, confirm one user genuinely cannot see the other's). Low risk given the policies are textbook-correct, but not yet manually proven.

---

## Phase 2 — Edge Function: `create-checkout` — ✅ Complete, fully verified

| # | Task | Status |
|---|---|---|
| All steps | Folder/file placed, secrets set, linked, deployed, tested against real sandbox | ✅ |
| Real test result | `checkoutLink: "https://pay.nomba.com/sandbox/..."`, `orderReference` returned by Nomba (different from the one sent) | ✅ |
| Visual confirmation | Opened real `checkoutLink` in browser — genuine Nomba sandbox checkout UI rendered correctly, "Pay ₦1,000" displayed matching sent amount, card entry + Transfer (NG) options shown | ✅ |
| Test payment attempt | Entered test PIN (`1234`/`0000`/`1111`/`5555` — all valid per sandbox UI) — payment failed. **Working theory, not yet confirmed:** sandbox sub-account authorization (the Google Form) may gate actual payment *processing*, not just webhook delivery. Checkout session creation itself is proven working regardless of this. | ⚠️ Noted, not blocking |

---

## Phase 3 — Edge Function: `nomba-webhook` — ✅ Deployed and reachable; ⏳ signature unverified live

| # | Task | Status |
|---|---|---|
| File placed, deployed | ✅ |
| **Critical fix discovered:** Supabase platform-level JWT verification blocks ALL unauthenticated callers by default, including Nomba's own webhook deliveries (which carry `nomba-signature`/`nomba-timestamp`, not a Supabase JWT). Initial deploy returned `401 UNAUTHORIZED_NO_AUTH_HEADER` on a bare curl test. | ✅ Found and fixed |
| Fix applied: `verify_jwt = false` added to `supabase/config.toml` under `[functions.nomba-webhook]`, function redeployed | ✅ |
| Confirmed fix: bare `curl` to the deployed URL now returns `405 Method not allowed` (correct — function logic itself rejects GET, proving the platform gate no longer blocks it) | ✅ |
| Webhook URL + sub-account ID submitted via Nomba's Google Form | ✅ Submitted |
| Real `NOMBA_WEBHOOK_SECRET` received | ❌ Still placeholder — pending Nomba's response |
| Signature verified against a real delivered webhook payload | ❌ Blocked on the above |

**Deployed webhook URL (real, public, confirmed reachable):**
`https://gaivftcuqhlffwzdnljv.supabase.co/functions/v1/nomba-webhook`

---

## Phase 5 — Edge Function: `charge-subscriptions` — ✅ Complete, fully verified under real conditions

| # | Task | Status |
|---|---|---|
| File written, deployed | ✅ |
| Tested against empty state | ✅ — `{"message":"No subscriptions due","attempted":0,"results":[]}` |
| **Critical fix discovered:** same JWT-verification problem as the webhook — pg_cron and a server-side trigger button are not logged-in users and can't send a Supabase user JWT. Initial attempt using the Supabase `secret` key as a Bearer token failed with `401 UNAUTHORIZED_ASYMMETRIC_JWT` (new-format secret keys are not JWTs). | ✅ Found and fixed |
| Fix applied: `verify_jwt = false` added to `config.toml` under `[functions.charge-subscriptions]`; **custom `CRON_SECRET` check added directly in the function code** (a value generated ourselves via `openssl rand -hex 32`, unrelated to any Supabase or Nomba key) since disabling the platform gate means the function must authenticate callers itself | ✅ |
| Confirmed: correct secret → `200` success response; wrong secret → `401 {"error":"Unauthorized"}` | ✅ Both confirmed |
| **Seeded one real test subscription manually** (plan: ₦500/daily; payment method with a fake placeholder `token_key`; subscription with `next_charge_at = now()`) to test real trigger logic, since a real payment_method normally only gets created via a successful webhook — which we don't have yet | ✅ |
| Triggered against the real seeded subscription | ✅ — Result: `outcome: "triggered"` (Nomba accepted the request, `code: "00"`) |
| **Important finding:** Nomba returning `code: "00"` on `/v1/checkout/tokenized-card-payment` only means *accepted for processing*, not *payment confirmed*. Confirmed via direct DB check: the resulting `charges` row correctly stayed at `status: "pending"`, `nomba_transaction_id: NULL` — exactly as designed. The architecture's deliberate separation (trigger ≠ confirm) held up correctly under a real test, even with a completely fake card token. | ✅ Confirmed working as designed |

---

## Phase 4 — pg_cron Scheduling — ✅ Set up, tested, then deliberately paused

| # | Task | Status |
|---|---|---|
| `cron.schedule('charge-subscriptions-demo', '* * * * *', ...)` created using the `CRON_SECRET` in the Authorization header | ✅ — returned `jobid: 1` |
| Confirmed actually firing | ✅ — `cron.job_run_details` showed 3+ consecutive runs, all `status: succeeded`, clean 60-second intervals |
| Paused via `select cron.unschedule('charge-subscriptions-demo');` | ✅ — confirmed `unschedule: true` |

**Why paused:** no real subscriptions exist yet and webhook authorization is still pending, so running every minute indefinitely just generates noise/unnecessary calls. Re-schedule with the same command whenever active testing or a live demo requires it.

---

## Phase 6 — Direct Debit Mandates (NEW — handed to Claude Code) — ❌ Not started

| # | Task | Status |
|---|---|---|
| Schema: `mandates` table, `subscriptions.mandate_id`, exactly-one-rail constraint | ❌ |
| `create-mandate` Edge Function | ❌ |
| `charge-subscriptions` branching logic (card vs mandate) | ❌ |
| Reconciliation/polling job for mandate status (no webhook exists for this) | ❌ |
| Live test against real sandbox: create a real mandate, inspect real response | ❌ |

See `claude-code-brief.md` for the full, OpenAPI-verified spec. **Every step here requires team-lead approval before being marked done — see Team Workflow guardrails above.**

---

## Phase 7 — Frontend (NEW — handed to Claude Code) — ❌ Not started

| # | Task | Status |
|---|---|---|
| 7.1 | Sign-up / login screens (Supabase Auth, password + magic link) | ❌ |
| 7.2 | Checkout flow: real page calling `create-checkout`, redirect to `checkoutLink` | ❌ |
| 7.3 | Dashboard: subscriptions + charges ledger (RLS-protected automatically) | ❌ |
| 7.4 | `profiles` table + `is_admin`, admin panel, `admin-trigger-charge` Edge Function | ❌ |
| 7.5 | Manual "Trigger charge now" button wired to `admin-trigger-charge` | ❌ |
| 7.6 | Seed real demo data | ❌ |
| 7.7 | Full demo dry run | ❌ |
| 7.8 | Backup demo video | ❌ |

Design direction approved by team lead via `keoterapay-preview.html` mockup (ink navy / gold accent / serif display / ledger-style charge history). See `claude-code-brief.md` section 7 for full token system. **Every step here requires team-lead approval before being marked done.**

---

## Phase 8 — Submission

| # | Task | Status |
|---|---|---|
| 8.1 | Idea submission form | ✅ Complete |
| 8.2 | README finalized (this tracker can serve as the deploy-steps section) | ❌ |
| 8.3 | Repo pushed to GitHub | ❌ |
| 8.4 | Final submission form completed | ❌ |
| 8.5 | Confirm submission received | ❌ |

---

## Challenges & Bottlenecks Log

**1. `npm install -g supabase` is blocked.** Fix: `npm install -D supabase` + `npx supabase ...`.

**2. Three conflicting API specs reconciled the hard way** — see "Live API Findings" table above. Single most valuable material for the eventual blog writeup.

**3. `sandbox.api.nomba.com` does not exist** — confirmed NXDOMAIN via two independent DNS resolvers. Real sandbox host is `sandbox.nomba.com`.

**4. Multi-line `curl`/`secrets set` commands with `\` continuations silently broke on misaligned backslashes**, causing part of a value to be interpreted as a separate shell command. Fix: single unbroken lines, every value double-quoted.

**5. Manually setting `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` is blocked by the CLI** — correct, intentional behavior; these are auto-injected.

**6. Supabase's key system changed** to `publishable`/`secret` — functionally equivalent to legacy `anon`/`service_role`, worked with zero code changes once the right key was used.

**7. Nomba returns its own `orderReference` on checkout creation**, different from the one sent — not documented anywhere checked; decided to treat Nomba's returned value as canonical going forward.

**8. Real sandbox test payment failed at the PIN step.** Reached a genuine PIN screen (revealing valid sandbox test PINs: `1234`/`0000`/`1111`/`5555`), entered one, got "Payment Failed." Working theory: sandbox sub-account needs Nomba-side authorization (the Google Form) before payments process, not just before webhooks deliver. Checkout session creation itself is proven working regardless.

**9. Both `nomba-webhook` and `charge-subscriptions` initially failed with platform-level `401` errors** (`UNAUTHORIZED_NO_AUTH_HEADER`, then `UNAUTHORIZED_ASYMMETRIC_JWT`) because Supabase requires a valid JWT on every Edge Function call by default — and neither Nomba's webhook deliveries nor pg_cron/our own trigger calls can supply one. **Fix:** `verify_jwt = false` in `supabase/config.toml` for both functions, with `nomba-webhook` relying on its own HMAC signature check and `charge-subscriptions` gaining a new custom `CRON_SECRET` check, since disabling the platform gate means the function itself must be the only thing standing between it and the open internet. This is a genuinely important, easy-to-miss platform behavior — without this fix, every real webhook from Nomba would have silently failed at the gateway, never reaching our signature verification code at all, with no obvious error visible during a live demo.

**10. Nomba's `tokenized-card-payment` endpoint returned `code: "00"` (success) even with a completely fake, placeholder `token_key`.** Initially looked like a bug or a sandbox validation gap. Confirmed via direct DB inspection that the resulting charge correctly stayed `pending` — the `code: "00"` only means "accepted for async processing," not "payment confirmed." This is the architecture working exactly as designed: only a verified webhook may ever mark a charge `successful`. Worth stating explicitly for anyone reproducing this: do not treat a `code: "00"` synchronous response from this endpoint as proof of payment.

**11. Direct Debit Mandates use TWO DIFFERENT response envelope shapes across their own two main endpoints** — mandate creation uses `responseCode`/`responseMessage`, mandate debiting uses `code`/`description`/`status`. Confirmed from the real OpenAPI spec, not a typo in either source. Any code written against these endpoints must check the correct field per endpoint, not assume consistency.

**12. There is no mandate-specific webhook event.** Confirmed from the complete, official list of 6 webhook events — none relate to mandates. Mandate status changes and debit confirmations must be polled via `GET /v1/direct-debits/status`, never pushed via webhook. This is a fundamentally different confirmation pattern from the card rail and must not be built assuming webhook delivery will happen.

**Known risks carried over, not yet resolved:**
- Webhook signature scheme reasoned through from live docs but **not yet tested against a real delivered webhook** — blocked on Nomba's sub-account authorization.
- Sub-account ID's exact usage — unclear, asked in the Nomba engineer AMA (June 26).
- No automatic reconciliation job exists yet for charges stuck in `pending` indefinitely if a webhook never arrives — the Verify Transactions API was flagged in original docs as the intended fallback for exactly this case; not yet built.
- Frontend's "Trigger charge now" button architecture (how to expose it without leaking `CRON_SECRET` to the browser) is now designed (see `admin-trigger-charge` in the brief) but not yet built or tested.
- Whether mandate debiting's synchronous `code: "00"` response means actual confirmation, or just "accepted for processing" like the card rail — not yet live-tested.

---

## Quick Reference — File Map

| File | Purpose |
|---|---|
| `PROJECT_INSTRUCTIONS.md` | Original correction doc (separate-project decision) — still accurate |
| `session-brief.md` | Original planning context — deadline assumption ("this weekend") since corrected; see real hackathon calendar above |
| `nomba-api-reference.md` | Original API reference — confirmed accurate on nearly every point live docs/training disagreed on |
| `schema.sql` | Database schema (5 tables + RLS) — deployed and confirmed live |
| `create-checkout.ts` | ✅ Deployed and confirmed working end-to-end |
| `nomba-webhook.ts` | ✅ Deployed, reachable; signature scheme unverified against a live delivery |
| `charge-subscriptions/index.ts` | ✅ Deployed, tested, secured with `CRON_SECRET` |
| `config.toml` | Contains `verify_jwt = false` for both `nomba-webhook` and `charge-subscriptions` |
| `claude-code-brief.md` | Full OpenAPI-verified brief for Direct Debit Mandates + frontend build, with mandatory approval guardrails |
| `nomba-engineer-session-questions.md` | Questions sent ahead of the Nomba AMA (June 26) |
| `idea-submission.docx` | Completed hackathon idea submission, application name KeoteraPay |
| `keoterapay-preview.html` | Approved design mockup — login + dashboard, ink navy / gold / serif direction |
| `ngrok-local-testing-guide.md` | Reference only — local webhook testing path was skipped entirely |
| `PROGRESS_TRACKER.md` | This file |

---

## Project Plan (current)

- Backend (Phases 0–5) is **fully built, deployed, and verified against the real Nomba sandbox** — this is a genuinely solid foundation, not a demo-only hack.
- Phases 6–7 (Mandates, Frontend) are handed to Claude Code with a full, OpenAPI-verified brief and mandatory step-by-step approval guardrails — nothing in those phases counts as done until the team lead reviews real evidence and confirms.
- Webhook signature verification remains the one piece that needs Nomba's cooperation (sub-account authorization) before it can be fully proven — everything on our side is ready and waiting.
- Every Edge Function decision in this build has been live-verified against the real sandbox, not just documentation-reasoned — including two genuinely non-obvious platform gotchas (JWT verification blocking webhooks/cron calls) that would have silently broken the system in production if undiscovered.
- This tracker's Challenges Log is the raw material for the eventual Medium/blog writeup and company lesson-note docx, to be assembled once the build is far enough along to write about meaningfully.
