# Nomba Checkout & Recurring — Deploy Guide & Progress Tracker

**Origin:** Nomba Solutions hackathon (via DevCareer x Nomba Hackathon 2026) — Track: Checkout, Recurring
**Current scope:** No longer hackathon-only. Building this as the real foundation for a fintech product. Correctness, security, and architecture take priority over speed.
**Stack:** Supabase (Postgres + Auth + Edge Functions + pg_cron) · Nomba API · React frontend (not yet built — see Phase 6)
**Application name (idea submission):** KeoteraPay

---

## Where We Stopped

**Session paused 2026-07-06.**

- **PRODUCTION WEBHOOK VERIFIED:** Successfully switched to live Nomba credentials and confirmed end-to-end webhook reconciliation. Real ₦100 payment processed; signature verified; `payment_methods` updated with `tokenKey`; `charges` row updated to `successful`. This completes the core backend payment loop.
- **Frontend Development:** React frontend (Phase 7) is currently in progress. Basic dashboard and login flows have been implemented.

---

## Completion log — what the team lead has actually approved, and when

| Date | Step approved | Approved by | Evidence reviewed |
|---|---|---|---|
| 2026-07-06 | **Production Webhook Reconciliation**; ₦100 test payment successfully confirmed via signature-verified webhook | Team lead | Confirmation of real transaction success in DB and matched HMAC-SHA256 signature |
| 2026-07-02 | Frontend Phase 7: React login, dashboard, and basic checkout flow | Team lead | Commit `f41fe34c6b9b02f9996ce84c470883c012080a59` |
| 2026-06-25 | pg_cron scheduled, fired 3+ times every 60s, all `status: succeeded`, then deliberately unscheduled | Team lead | Screenshot of `cron.job_run_details` query results; screenshot of `unschedule: true` |

**Still open, NOT in this log because not yet approved (or not yet attempted):**
- React frontend (Phase 7) — Final polish, edge cases, and full demo data seeding
- Direct Debit Mandate integration (Phase 6) — Brief handed to Claude Code, no steps approved yet
- Reconciliation job for stuck-`pending` charges — Not yet built

---

## Phase 3 — Edge Function: `nomba-webhook` — ✅ Complete, fully verified on Production

| # | Task | Status |
|---|---|---|
| File placed, deployed | ✅ |
| **Critical fix discovered:** Supabase platform-level JWT verification blocks ALL unauthenticated callers by default. | ✅ Found and fixed |
| Fix applied: `verify_jwt = false` added to `supabase/config.toml` | ✅ |
| Confirmed fix: bare `curl` to the deployed URL returns `405` | ✅ |
| Webhook URL + sub-account ID registered on Nomba Production | ✅ |
| Real `NOMBA_WEBHOOK_SECRET` set as Supabase secret | ✅ |
| Signature verified against a real delivered PRODUCTION webhook payload | ✅ Verified via ₦100 test payment |
