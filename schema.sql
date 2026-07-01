-- schema.sql
-- Baseline snapshot of the live public schema as of 2026-06-26.
-- This file reflects exactly what is deployed in Supabase project
-- gaivftcuqhlffwzdnljv (nomba-checkout-recurring) BEFORE any Phase 6 changes.
--
-- Sources used to reconstruct this file:
--   information_schema.columns   — column names, types, nullability, defaults
--   information_schema.table_constraints + check_constraints — PKs, UNIQUEs, CHECKs
--   information_schema.referential_constraints — FK relationships (public→public only;
--     cross-schema FKs to auth.users confirmed via pg_constraint joined with pg_class/pg_namespace)
--   pg_policies                  — RLS policy definitions
--   pg_class (relrowsecurity)    — which tables have RLS enabled
--
-- Phase 6 additions (mandates table, profiles table, subscriptions alterations)
-- are in supabase/migrations/20260626000000_add_mandates_and_profiles.sql — NOT here.
-- Do not merge the two files.

-- ---------------------------------------------------------------------------
-- plans
-- ---------------------------------------------------------------------------

create table plans (
  id         uuid    primary key default gen_random_uuid(),
  name       text    not null,
  amount     numeric not null,
  currency   text    not null default 'NGN',
  interval   text    not null,
  created_at timestamptz default now(),
  constraint plans_interval_check check (interval in ('daily', 'weekly', 'monthly'))
);

alter table plans enable row level security;
-- No SELECT policy: plans are read only via service_role (server-side functions).
-- End users never query this table directly.

-- ---------------------------------------------------------------------------
-- payment_methods
-- ---------------------------------------------------------------------------

create table payment_methods (
  id         uuid    primary key default gen_random_uuid(),
  customer_id uuid   not null references auth.users(id),
  token_key  text    not null,
  card_type  text,
  card_last4 text,
  is_active  boolean default true,
  created_at timestamptz default now()
);

alter table payment_methods enable row level security;
create policy "own payment methods" on payment_methods
  for select using (auth.uid() = customer_id);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------

create table subscriptions (
  id                uuid        primary key default gen_random_uuid(),
  customer_id       uuid        not null references auth.users(id),
  plan_id           uuid        not null references plans(id),
  payment_method_id uuid        not null references payment_methods(id),
  status            text        not null default 'active',
  next_charge_at    timestamptz not null,
  created_at        timestamptz default now(),
  constraint subscriptions_status_check check (status in ('active', 'past_due', 'cancelled'))
);

alter table subscriptions enable row level security;
create policy "own subscriptions" on subscriptions
  for select using (auth.uid() = customer_id);

-- ---------------------------------------------------------------------------
-- charges
-- ---------------------------------------------------------------------------

create table charges (
  id                   uuid    primary key default gen_random_uuid(),
  subscription_id      uuid    not null references subscriptions(id),
  order_reference      text    not null unique,
  amount               numeric not null,
  status               text    not null,
  nomba_transaction_id text,
  failure_reason       text,
  charged_at           timestamptz default now(),
  constraint charges_status_check check (status in ('pending', 'successful', 'failed'))
);

alter table charges enable row level security;
create policy "own charges" on charges
  for select using (
    subscription_id in (
      select id from subscriptions where customer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- nomba_auth_cache
-- Singleton table (enforced by CHECK id = 1 + default id = 1).
-- Holds the cached Nomba OAuth token so Edge Functions don't re-authenticate
-- on every call. Only ever touched server-side via service_role.
-- ---------------------------------------------------------------------------

create table nomba_auth_cache (
  id            integer primary key default 1,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  constraint single_row check (id = 1)
);

alter table nomba_auth_cache enable row level security;
-- No policies: no end-user path to this table — service_role only.
