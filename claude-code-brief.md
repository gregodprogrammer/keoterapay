# KeoteraPay — Build Brief for Claude Code

**READ THIS GUARDRAILS SECTION FIRST. IT IS NOT OPTIONAL CONTEXT — IT IS A SET OF RULES YOU MUST FOLLOW FOR EVERY STEP OF THIS SESSION.**

---

## GUARDRAILS — Mandatory approval process for every step

This project is run by a team lead (the human you are working with). You are a contributor on this team, not the decision-maker on what counts as "done." The following rules apply to every single step in this brief, no exceptions:

1. **You may never mark a step complete based on your own judgment alone.** "I've implemented X" or "this should work" is not completion. A step is only complete when the team lead has reviewed real evidence and explicitly confirmed it — a literal "okay," "confirmed," "approved," or equivalent in their own words. If they haven't said so, the step is still open, no matter how confident you are in the code.

2. **Every claim must be backed by real, pasted, live evidence — not your description of what should happen.** Before saying anything is working:
   - If it's an API call: run the actual curl/test against the real Nomba sandbox and show the actual response.
   - If it's a database change: run the actual query and show the actual returned rows.
   - If it's a deployed function: show the actual deploy command output AND a real test call result.
   - Never write "this returns X" or "this should return X" without having actually run it and pasted what really came back.

3. **After completing any single step, STOP and present it to the team lead for review before continuing to the next step.** Do not chain multiple steps together and present a batch summary at the end. Present one step, wait for explicit confirmation, only then proceed. If you're unsure whether something counts as one step or several, treat it as several and ask after each one.

4. **When presenting a step for review, structure it exactly like this:**
5. **The team lead can overwrite, skip, reorder, or change any step at any time.** If they say "skip this," "do it differently," or "we're changing direction," that instruction overrides this brief immediately. This brief is a starting plan, not a contract you enforce against the team lead.

6. **Items already known to be blocked or incomplete from before this session must stay visibly open until the team lead says otherwise — never silently mark them resolved:**
   - Webhook signature has NOT been tested against a real delivered webhook payload. Still blocked on Nomba's sandbox sub-account authorization (a Google Form was submitted; no response yet as of this session). Do not write or imply this is resolved unless the team lead tells you a real webhook was received and verified.
   - The real test payment in the sandbox previously failed at the PIN entry step (`1234`/`0000`/`1111`/`5555` are valid sandbox PINs per the UI, but the payment still failed). Root cause is unconfirmed — working theory is the same sandbox authorization gating as above. Do not assume this is fixed.
   - There is no reconciliation job yet for card charges stuck in `pending` forever if a webhook never arrives. This is a known gap, not yet built. Do not close this silently while building something else — if you build it, present it as its own explicit step per rule 3 and 4 above.

7. **If you find a genuine discrepancy between this brief and what the live sandbox actually does, stop and flag it explicitly — do not silently "fix" or paper over it.** This entire project has a history of multiple sources (a cached reference doc, a third-party training course, and even Nomba's own OpenAPI spec across different endpoints) disagreeing with each other. The live sandbox response is the authority, but the team lead decides what to do about any conflict — present the discrepancy clearly and wait.

8. **Update `PROGRESS_TRACKER.md` as you go, following its existing format exactly** (Live API Findings table, numbered Challenges & Bottlenecks Log entries, the "Where We Stopped" block) — but do not consider a tracker update itself "done" until the team lead has reviewed and approved it too, same as any other step.

---

## Project context (read after the guardrails above)

- Repo: `~/nomba-checkout`
- Supabase project: `nomba-checkout-recurring`, ref `gaivftcuqhlffwzdnljv`
- Nomba sandbox base URL: `https://sandbox.nomba.com` (CONFIRMED live, do not use `sandbox.api.nomba.com` — that domain does not exist, confirmed NXDOMAIN)
- Three Edge Functions already deployed and working: `create-checkout`, `nomba-webhook`, `charge-subscriptions`
- Local secrets file: `.env.sandbox.local` (gitignored) holds test credentials
- Supabase project uses NEW key format: `publishable` (`sb_publishable_...`) and `secret` (`sb_secret_...`) — not legacy `anon`/`service_role`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every Edge Function — do NOT try to set these as secrets, the CLI blocks it intentionally
- Two existing functions (`nomba-webhook`, `charge-subscriptions`) have `verify_jwt = false` in `supabase/config.toml` because they're called by Nomba's servers / pg_cron, not logged-in users. `charge-subscriptions` checks a custom `CRON_SECRET` env var itself since the platform JWT gate is off.

---

## 1. Goal for this session

Two deliverables:
1. **Add Direct Debit Mandates as a second payment rail**, parallel to the existing tokenized-card rail. A subscription can be funded by EITHER a card token OR a mandate, never both.
2. **Build the React frontend** — login (password + magic link), customer dashboard, admin panel with a "trigger charge now" button.

---

## 2. CONFIRMED Nomba Direct Debit API shapes (from live OpenAPI spec, developer.nomba.com)

### 2a. Create a mandate — `POST /v1/direct-debits`

Required header: `accountId` (same as every other endpoint)

Required body fields: `customerAccountNumber`, `bankCode`, `customerName`, `customerAccountName`, `amount` (number, not string — different from checkout!), `frequency`, `merchantReference`, `startDate`, `endDate`, `customerEmail`

Optional fields: `customerAddress`, `customerPhoneNumber`, `narration`, `startImmediately`

`frequency` enum (CONFIRMED complete list): `VARIABLE`, `WEEKLY`, `EVERY_TWO_WEEKS`, `MONTHLY`, `EVERY_TWO_MONTHS`, `EVERY_THREE_MONTHS`, `EVERY_FOUR_MONTHS`, `EVERY_FIVE_MONTHS`, `EVERY_SIX_MONTHS`, `EVERY_SEVEN_MONTHS`, `EVERY_EIGHT_MONTHS`, `EVERY_NINE_MONTHS`, `EVERY_TEN_MONTHS`, `EVERY_ELEVEN_MONTHS`, `EVERY_TWELVE_MONTHS`

`merchantReference` must be a NUMERIC string (0-9 only), unique per transaction — NOT a UUID like `orderReference` elsewhere. This is a real constraint, validate it client-side before sending.

Response uses a DIFFERENT envelope than every other endpoint in this codebase:
```json
{
  "responseMessage": "Success",
  "responseCode": "00",
  "data": {
    "mandateId": "uuid-string",
    "merchantReference": "...",
    "phoneNumber": "...",
    "description": "Welcome to NIBSS e-mandate authentication service... Kindly proceed with a token payment of N50.00 into account number XXXX with [Bank Name]. This payment will trigger the authentication of your mandate."
  }
}
```
Note: success check is `responseCode === "00"`, NOT `code === "00"` like every other endpoint. Do not copy the checkout success-check pattern here, it will silently fail.

**Authentication mechanism is fundamentally different from checkout**: there is no hosted URL to redirect to. The customer authenticates by making a real ₦50 bank transfer to a specific account number given in the `description` field. The frontend must parse/display this instruction clearly — extracting the amount and account number from that description string, or treating the whole string as instructional copy to show verbatim. Decide which approach during the build and confirm with the user before assuming.

### 2b. Debit a mandate — `POST /v1/direct-debits/debit-mandate`

Request:
```json
{ "mandateId": "string", "amount": "110.00" }
```
Note: `amount` here IS a string (decimal), unlike creation's `amount` which is a number. Confirmed from the OpenAPI spec — do not assume consistency between these two endpoints.

Response uses YET ANOTHER envelope shape (closer to checkout's):
```json
{
  "code": "00",
  "description": "SUCCESS",
  "data": {
    "mandateId": "...",
    "status": "SUCCESS",
    "amount": "110.00",
    "message": "Approved or completed successfully"
  },
  "message": "SUCCESS",
  "status": true
}
```
Success check here IS `code === "00"`. This is genuinely inconsistent with the creation endpoint's `responseCode` field — both are real, both confirmed from the spec, do not "fix" this by assuming one is a typo.

**Open question, NOT YET LIVE-TESTED**: does this endpoint's success response mean the debit is actually confirmed, or only "accepted for processing" (the same async pattern as `/checkout/tokenized-card-payment`)? There is no `maxAmount`/ceiling field anywhere in the real schema (checked create, debit, and status endpoints) — the practical ceiling is likely just the `amount` set at mandate creation time, but this has not been live-tested. Before trusting this synchronously, write the same defensive pattern used in `charge-subscriptions` for cards: insert a `pending` charges row first, only mark `successful` once independently confirmed.

### 2c. Get mandate status — `GET /v1/direct-debits/status?mandateId={mandateId}`

`mandateId` is a QUERY PARAMETER, not a path segment. `accountId` header still required.

Response:
```json
{
  "code": "00",
  "description": "SUCCESS",
  "data": {
    "customerAccountName": "...",
    "mandateId": "...",
    "customerAccountNumber": "...",
    "mandateStatus": "Active",
    "rejectionComment": "Expired e-mandate",
    "mandateAdviceStatus": "Advise not sent"
  },
  "message": "SUCCESS",
  "status": true
}
```

### 2d. CRITICAL FINDING — no mandate webhook event exists

CONFIRMED from the full official webhook events list (`developer.nomba.com/docs/api-basics/webhook`): the only 6 webhook events Nomba sends are `payment_success`, `payout_success`, `payment_failed`, `payment_reversal`, `payout_failed`, `payout_refund`. **There is no mandate-status-change webhook.** This means `nomba-webhook.ts` should NOT be modified to expect mandate events — they don't exist. Mandate status (active/rejected/suspended) and debit confirmation must be tracked via POLLING `GET /v1/direct-debits/status`, not webhook push. Plan a periodic reconciliation job for this (could be a second pg_cron job, lower frequency, e.g. every 10 minutes) — do not build this assuming a webhook will arrive.

### 2e. Webhook signature scheme — RECONFIRMED, no changes needed to existing code

The official multi-language code samples (Go/Python/JS/Java/C#/PHP) on `developer.nomba.com/docs/api-basics/webhook` all build the exact same hash as what's already in `nomba-webhook.ts`:
HMAC-SHA256, base64-encoded. This is now confirmed from FOUR independent sources (old reference doc, this OpenAPI page, and the earlier signature-verification page search). Do not change this code. The one thing still genuinely unverified is testing it against a REAL delivered webhook payload — that remains blocked on Nomba's sandbox sub-account authorization (Google Form submitted, no response yet).

There is also a `nomba-sig-value` header shown alongside `nomba-signature` in the official example, with what appears to be an identical value. Defensive improvement: check both header names, prefer `nomba-signature`, fall back to `nomba-sig-value` if absent.

### 2f. Idempotency — CONFIRMED official guidance

`X-Idempotent-key` header (exact casing). Nomba states their system already handles idempotency internally but recommends sending one anyway, "especially for endpoints such as Bank Transfer." Add this header (a fresh UUID per request) to both `debit-mandate` calls and the existing `tokenized-card-payment` calls in `charge-subscriptions` as a defensive improvement — this is additive, does not change existing confirmed-working logic.

### 2g. Retry/backoff timing — CONFIRMED exact values

1: 120s · 2: 280s · 3: 640s · 4: 1440s · 5: 3200s — total ~53 min across 5 retries. (Already matches what's in the tracker, just now confirmed from the primary source.)

---

## 3. Schema changes needed

```sql
-- New table: mandates
create table mandates (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  nomba_mandate_id text not null unique,
  customer_account_number text not null,
  bank_code text not null,
  amount numeric not null,
  frequency text not null,
  status text not null default 'pending' check (status in ('pending','active','rejected','suspended','cancelled')),
  merchant_reference text not null unique,
  created_at timestamptz default now()
);

alter table mandates enable row level security;
create policy "own mandates" on mandates for select using (auth.uid() = customer_id);

-- subscriptions: allow EITHER a payment_method OR a mandate, never both, never neither
alter table subscriptions alter column payment_method_id drop not null;
alter table subscriptions add column mandate_id uuid references mandates(id);
alter table subscriptions add constraint exactly_one_rail check (
  (payment_method_id is not null and mandate_id is null) or
  (payment_method_id is null and mandate_id is not null)
);
```

`merchant_reference` must be generated as a numeric-only string (the Nomba constraint above) — e.g. a timestamp + random digits, NOT `crypto.randomUUID()` which contains hyphens and letters.

---

## 4. New Edge Function: `create-mandate`

Mirrors `create-checkout.ts`'s structure (auth check via user JWT, token caching via existing `nomba_auth_cache` table, same env var names for Nomba credentials). Calls `POST /v1/direct-debits` per section 2a above. Returns the parsed instruction (account number + amount to transfer, or the raw description string — decide presentation approach during build) to the frontend, and stores a `pending` mandate row.

---

## 5. `charge-subscriptions` changes

Branch on which rail the subscription uses (`payment_method_id` vs `mandate_id`):
- **Card branch**: existing logic, unchanged, already proven working.
- **Mandate branch**: new — call `debit-mandate` per section 2b, using STRING amount (different from card branch's existing string-amount convention — actually consistent here, good). Insert `pending` charge first, same pattern as card branch. Given no webhook will confirm this (section 2d), either treat the synchronous `code: "00"` + `data.status: "SUCCESS"` response as confirmation (live-test this assumption first), or poll `GET /v1/direct-debits/status` shortly after as a follow-up confirmation step.

Add `X-Idempotent-key` header (fresh UUID per call) to both the existing card-payment call and the new mandate-debit call.

---

## 6. New backend pieces for admin trigger button

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for select using (auth.uid() = id);

create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, is_admin) values (new.id, false);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

New Edge Function: `admin-trigger-charge`. Default JWT verification stays ON (this one IS called by a logged-in user, unlike `charge-subscriptions`). Inside the function: verify the caller's `profiles.is_admin = true` (query with the user's own JWT-derived `auth.uid()`), then internally call `charge-subscriptions` using the `CRON_SECRET` it holds as its own server-side secret. The browser never sees `CRON_SECRET` — it only ever sends its own normal Supabase session token to `admin-trigger-charge`.

---

## 7. Frontend

Vite + React. Supabase Auth with BOTH password and magic-link sign-in (toggle UI). Pages: login/signup, customer dashboard (subscriptions + append-only charge ledger, reads via RLS automatically), admin panel (gated on `profiles.is_admin`, shows "Trigger charge now" button calling `admin-trigger-charge`).

**Approved design direction** (already validated with the user via an HTML mockup, do not redesign from scratch):
- Palette: ink navy bg (`#0B1220`), raised surface (`#121B2E`/`#16213A`), gold accent (`#CCA300`, deliberately matching Nomba's own brand gold), warm off-white text (`#F2EFE9`), muted slate secondary text (`#8B96A8`), hairline borders (`#1E2A42`)
- Type: Fraunces (serif, display headings) + Inter (body/UI) + JetBrains Mono (ledger amounts — the signature element)
- Signature element: charge history as a literal ledger — monospace right-aligned amounts, thin rules between rows, a small status dot (not a pill badge) for success/pending/failed
- Tone: calm, plainspoken, trust-stated-as-concrete-facts (e.g. "Every payment event is signature-checked before it touches your ledger" rather than vague marketing copy) — inspired by leestam.com's real-estate trust-grid pattern, adapted to fintech
- The approved mockup file is `keoterapay-preview.html` if available in the repo/outputs — reference it for exact visual details (spacing, the auth tab toggle behavior, trust-grid copy) rather than reinventing.

---

## 8. Testing discipline — carry this forward

This entire project has been built with a strict rule: never trust documentation or training material without live-testing against the real sandbox first, because multiple sources (a cached reference doc, a third-party certification course, and even inconsistencies within Nomba's own real OpenAPI spec across different endpoints) have disagreed with each other throughout this build. Before considering any new mandate code "done," issue a real test mandate against the sandbox, inspect the real response, and confirm it matches section 2 above exactly. If it doesn't, trust the live response over this brief and update `PROGRESS_TRACKER.md` accordingly.

---

## 9. Known open items, not blocking, but don't forget

- Webhook signature still unverified against a real delivered payload (blocked on Nomba's sandbox sub-account authorization via Google Form, submitted, no response yet)
- No reconciliation job exists yet for card charges stuck in `pending` forever if a webhook never arrives — Verify Transactions API is the documented fallback, not yet built
- Sub-account ID's exact usage in requests is still undetermined (asked in the Nomba engineer AMA)
