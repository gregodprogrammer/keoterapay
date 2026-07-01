-- supabase/migrations/20260626000000_add_mandates_and_profiles.sql
-- Phase 6 additions: Direct Debit Mandates + admin Profiles.
-- Run AFTER the baseline schema in schema.sql is already live.
-- Do not modify schema.sql — this file is the honest record of what changed today.
--
-- What this migration does:
--   1. Creates the mandates table (new payment rail for Phase 6)
--   2. Alters subscriptions to make payment_method_id nullable and adds mandate_id,
--      with a CHECK constraint enforcing exactly one rail per subscription
--   3. Creates the profiles table (needed for admin-trigger-charge in Phase 7)
--   4. Adds the handle_new_user trigger that auto-inserts a profiles row on signup

-- ---------------------------------------------------------------------------
-- 1. mandates
--
-- merchant_reference is a NUMERIC-only string (Nomba constraint: 0-9 only,
-- no hyphens or letters — crypto.randomUUID() must NOT be used for this field).
-- Generate it as e.g. a timestamp + random digits in the calling Edge Function.
-- ---------------------------------------------------------------------------

create table mandates (
  id                     uuid        primary key default gen_random_uuid(),
  customer_id            uuid        not null references auth.users(id),
  nomba_mandate_id       text        not null unique,
  customer_account_number text       not null,
  bank_code              text        not null,
  amount                 numeric     not null,
  frequency              text        not null,
  status                 text        not null default 'pending',
  merchant_reference     text        not null unique,
  created_at             timestamptz default now(),
  constraint mandates_status_check check (
    status in ('pending', 'active', 'rejected', 'suspended', 'cancelled')
  )
);

alter table mandates enable row level security;
create policy "own mandates" on mandates
  for select using (auth.uid() = customer_id);

-- ---------------------------------------------------------------------------
-- 2. subscriptions alterations
--
-- payment_method_id drops NOT NULL so mandate-funded subscriptions can exist.
-- mandate_id is added as a nullable FK to mandates.
-- The exactly_one_rail CHECK enforces that every subscription has EITHER a
-- card token OR a mandate, never both and never neither.
-- ---------------------------------------------------------------------------

alter table subscriptions alter column payment_method_id drop not null;

alter table subscriptions
  add column mandate_id uuid references mandates(id);

alter table subscriptions
  add constraint exactly_one_rail check (
    (payment_method_id is not null and mandate_id is null) or
    (payment_method_id is null and mandate_id is not null)
  );

-- ---------------------------------------------------------------------------
-- 3. profiles
-- Used by admin-trigger-charge to gate admin access without exposing
-- CRON_SECRET to the browser. is_admin defaults false for all new users.
-- ---------------------------------------------------------------------------

create table profiles (
  id         uuid    primary key references auth.users(id) on delete cascade,
  is_admin   boolean not null default false,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
create policy "own profile" on profiles
  for select using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 4. Trigger: auto-insert a profiles row whenever a new auth.users row is created.
-- security definer so the function runs with elevated rights to insert into profiles.
-- ---------------------------------------------------------------------------

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
