-- ============================================================================
-- VanGo migration_005: security hardening + catalogue-pricing columns
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run
--
-- ⚠️ READ FIRST: the live database already contains policies/helper functions
-- added directly in the dashboard (is_my_assigned_driver, shares_job_with_user,
-- refresh_driver_rating, etc). This migration only DROPS the specific unsafe
-- policies named below and ADDS new ones -- it leaves everything else alone.
-- It is idempotent: safe to run more than once.
--
-- What this fixes (found in the 2026-07-08 security audit):
--  1. profiles: any user could update their OWN role -> 'admin' (privilege
--     escalation), and phone numbers were readable wherever a profile row
--     was readable. Now: column-level grants -- phone is NOT selectable by
--     clients at all; only full_name/phone are updatable (never role).
--  2. jobs: the policy "Drivers can update jobs" allowed ANY authenticated
--     user to update ANY pending job (change fee, addresses, anything).
--     Now: buyers update own jobs, drivers can only ACCEPT pending jobs
--     (must set themselves as driver), assigned drivers update their jobs --
--     and column-level grants stop clients writing driver_fee/service_fee/
--     addresses at all (fee re-rates go through /api/jobs/adjust-price).
--  3. drivers: "Authenticated can read online drivers" exposed every online
--     driver's live GPS to any logged-in user. Now: own row, the customer
--     on a shared job, or admin.
--  4. buyers had NO update policy on jobs, so the rating page silently
--     failed. Fixed by the buyer policy + rating columns in the grant.
--  5. admin had no read-all policies, so /admin showed nearly nothing.
--  6. job_status_events had no INSERT policy in schema.sql.
--  7. jobs.item_size check constraint didn't allow 'small'.
--  8. new columns for proof photos (photo-gated pickup/delivery) and the
--     driver price re-rate audit trail.
-- ============================================================================

-- ── 0. Admin helper (SECURITY DEFINER avoids RLS recursion on profiles) ─────
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;

grant execute on function public.is_admin() to authenticated;

-- ── 1. profiles: phone privacy + stop role self-escalation ──────────────────
-- Column-level privileges: clients can only SELECT non-sensitive columns
-- (NO phone) and only UPDATE full_name/phone (NO role). Row visibility is
-- still governed by RLS policies. The app reads the user's own phone from
-- auth metadata instead (see app/settings/page.tsx).
revoke select, update, insert, delete on public.profiles from anon, authenticated;
grant select (id, full_name, role, created_at) on public.profiles to authenticated;
grant update (full_name, phone) on public.profiles to authenticated;

-- Row policies: own row (already in schema.sql, kept), plus counterparties on
-- a shared job (so names show in chat/tracking), plus admin.
drop policy if exists "Profiles readable by job counterparties" on public.profiles;
create policy "Profiles readable by job counterparties" on public.profiles
  for select using (
    id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.jobs j
      where (j.buyer_id = auth.uid() and j.driver_id in (select id from public.drivers where user_id = profiles.id))
         or (j.buyer_id = profiles.id and j.driver_id in (select id from public.drivers where user_id = auth.uid()))
    )
  );

-- ── 2. drivers: stop broadcasting every online driver's live GPS ────────────
drop policy if exists "Authenticated can read online drivers" on public.drivers;
drop policy if exists "Drivers readable by owner, job customer, admin" on public.drivers;
create policy "Drivers readable by owner, job customer, admin" on public.drivers
  for select using (
    user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.jobs j where j.driver_id = drivers.id and j.buyer_id = auth.uid())
  );

-- Drivers can create their own row during onboarding (schema.sql had no
-- INSERT policy at all -- if one was added in the dashboard this is harmless).
drop policy if exists "Drivers can insert own record" on public.drivers;
create policy "Drivers can insert own record" on public.drivers
  for insert with check (user_id = auth.uid());

-- Admins can update drivers (approve / reject).
drop policy if exists "Admins can update drivers" on public.drivers;
create policy "Admins can update drivers" on public.drivers
  for update using (public.is_admin());

-- Column-level: drivers can't write their own rating / job count / Stripe
-- identifiers from the browser.
revoke update on public.drivers from anon, authenticated;
grant update (vehicle_type, vehicle_make, vehicle_model, vehicle_plate,
              is_online, current_lat, current_lng, location, location_updated_at,
              push_token, abn, license_number, is_approved)
  on public.drivers to authenticated;
-- NOTE: is_approved stays grantable so the admin page works (admins use the
-- same 'authenticated' role). RLS means a driver could only flip it on their
-- own row; nothing gates on is_approved yet except push notifications. When
-- approval becomes enforcement, move approve/reject to a server API route
-- and remove is_approved from this grant.

-- ── 3. jobs: replace the wide-open update policy + column-level grants ──────
drop policy if exists "Drivers can update jobs" on public.jobs;

-- Customers can update their own jobs (rating; the feature-flagged
-- cancellation goes through the server route which uses the service role).
drop policy if exists "Buyers can update own jobs" on public.jobs;
create policy "Buyers can update own jobs" on public.jobs
  for update using (buyer_id = auth.uid())
  with check (buyer_id = auth.uid());

-- Any driver can ACCEPT a pending job -- but the resulting row must be
-- 'accepted' and assigned to THEMSELVES.
drop policy if exists "Drivers can accept pending jobs" on public.jobs;
create policy "Drivers can accept pending jobs" on public.jobs
  for update using (
    status = 'pending'
    and exists (select 1 from public.drivers d where d.user_id = auth.uid())
  )
  with check (
    status = 'accepted'
    and driver_id in (select id from public.drivers where user_id = auth.uid())
  );

-- The assigned driver can update their own job (advance status, proof
-- photos, cancel back to pending).
drop policy if exists "Assigned driver can update own jobs" on public.jobs;
create policy "Assigned driver can update own jobs" on public.jobs
  for update using (
    driver_id in (select id from public.drivers where user_id = auth.uid())
  );

-- Admins can read everything.
drop policy if exists "Admins read all jobs" on public.jobs;
create policy "Admins read all jobs" on public.jobs
  for select using (public.is_admin());

-- Column-level: the browser can never write money fields or addresses on an
-- existing job. driver_fee changes only happen via the server-side
-- /api/jobs/adjust-price route (service role) with validation + audit trail.
revoke update on public.jobs from anon, authenticated;
grant update (status, driver_id, picked_up_at, delivered_at,
              cancelled_at, cancelled_by, cancellation_stage,
              rating, rating_comment, rated_at,
              pickup_photo_url, dropoff_photo_url,
              item_size, items)
  on public.jobs to authenticated;
-- (item_size/items stay updatable so a driver client can keep them in sync
-- after a server-side re-rate; the FEE itself is not writable.)

-- ── 4. job_status_events: participants can write the timeline ───────────────
drop policy if exists "Job participants can insert events" on public.job_status_events;
create policy "Job participants can insert events" on public.job_status_events
  for insert with check (
    exists (
      select 1 from public.jobs j
      left join public.drivers d on d.id = j.driver_id
      where j.id = job_status_events.job_id
        and (j.buyer_id = auth.uid() or d.user_id = auth.uid())
    )
  );

drop policy if exists "Admins read all events" on public.job_status_events;
create policy "Admins read all events" on public.job_status_events
  for select using (public.is_admin());

-- ── 5. Columns the code relies on (created only if missing) ─────────────────
-- Delivery lifecycle timestamps (analytics) + proof photos (photo-gated
-- pickup/delivery) + driver re-rate audit trail.
alter table public.jobs add column if not exists picked_up_at timestamptz;
alter table public.jobs add column if not exists delivered_at timestamptz;
alter table public.jobs add column if not exists cancellation_stage text;
alter table public.jobs add column if not exists rating int check (rating between 1 and 5);
alter table public.jobs add column if not exists rating_comment text;
alter table public.jobs add column if not exists rated_at timestamptz;
alter table public.jobs add column if not exists pickup_photo_url text;
alter table public.jobs add column if not exists dropoff_photo_url text;
alter table public.jobs add column if not exists original_driver_fee numeric(8,2);
alter table public.jobs add column if not exists price_adjusted_at timestamptz;

alter table public.drivers add column if not exists is_approved boolean not null default true;
-- default TRUE while approval isn't enforced anywhere; flip the default to
-- false when the approval flow launches for real.
alter table public.drivers add column if not exists abn text;
alter table public.drivers add column if not exists license_number text;
alter table public.drivers add column if not exists push_token text;
alter table public.drivers add column if not exists stripe_account_id text;
alter table public.drivers add column if not exists stripe_onboarded boolean not null default false;

-- ── 6. Allow the new 'small' size (post page already offers it) ─────────────
alter table public.jobs drop constraint if exists jobs_item_size_check;
alter table public.jobs add constraint jobs_item_size_check
  check (item_size in ('small','medium','large','xlarge'));

-- ── 7. push_subscriptions (used by /api/push/*; service-role only) ──────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
alter table public.push_subscriptions enable row level security;
-- no client policies on purpose: only the service role reads/writes these.

-- ── 8. chat_safety_actions (Block + Report in chat) ─────────────────────────
create table if not exists public.chat_safety_actions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid references public.profiles(id) on delete set null,
  message_id uuid,
  action_type text not null check (action_type in ('block','report')),
  note text,
  created_at timestamptz not null default now()
);
alter table public.chat_safety_actions enable row level security;

drop policy if exists "Participants can record safety actions" on public.chat_safety_actions;
create policy "Participants can record safety actions" on public.chat_safety_actions
  for insert with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.jobs j
      left join public.drivers d on d.id = j.driver_id
      where j.id = chat_safety_actions.job_id
        and (j.buyer_id = auth.uid() or d.user_id = auth.uid())
    )
  );

drop policy if exists "Actors and admins read safety actions" on public.chat_safety_actions;
create policy "Actors and admins read safety actions" on public.chat_safety_actions
  for select using (actor_id = auth.uid() or public.is_admin());

-- ============================================================================
-- End of migration_005
--
-- After running:
--  1. Sanity-check as a normal user: post a job, accept as a driver, chat,
--     advance to delivered (photo-gated), rate it.
--  2. Sanity-check as admin: /admin loads all jobs + drivers.
--  3. Confirm phone is NOT readable:   select phone from profiles;  -- should
--     fail with "permission denied for column phone" under the anon/auth key.
-- ============================================================================
