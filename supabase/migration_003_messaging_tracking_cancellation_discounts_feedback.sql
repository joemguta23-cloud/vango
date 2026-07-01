-- ============================================================================
-- VanGo migration_003: messaging, live GPS tracking, cancellation policy,
-- discount codes, and feedback/complaints
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================================

-- 1. In-app messaging between buyer and driver on a job -----------------------
create table if not exists job_messages (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table job_messages enable row level security;

drop policy if exists "Job participants can read messages" on job_messages;
create policy "Job participants can read messages" on job_messages
  for select using (
    exists (
      select 1 from jobs j
      left join drivers d on d.id = j.driver_id
      where j.id = job_messages.job_id
        and (j.buyer_id = auth.uid() or d.user_id = auth.uid())
    )
  );

drop policy if exists "Job participants can send messages" on job_messages;
create policy "Job participants can send messages" on job_messages
  for insert with check (
    sender_id = auth.uid() and exists (
      select 1 from jobs j
      left join drivers d on d.id = j.driver_id
      where j.id = job_messages.job_id
        and (j.buyer_id = auth.uid() or d.user_id = auth.uid())
    )
  );

-- 2. Live GPS tracking for drivers (Uber-Eats style) --------------------------
alter table drivers add column if not exists current_lat double precision;
alter table drivers add column if not exists current_lng double precision;
alter table drivers add column if not exists location_updated_at timestamptz;

-- Buyers on an active job need to read their assigned driver's live location.
-- (Existing "Authenticated can read online drivers" policy already covers
-- reading the drivers table; no extra policy needed unless that policy is
-- narrower than expected -- verify before relying on this in production.)

-- 3. Cancellation policy (built but NOT activated in the UI yet) --------------
alter table jobs add column if not exists cancelled_at timestamptz;
alter table jobs add column if not exists cancelled_by uuid references profiles(id);
alter table jobs add column if not exists cancellation_fee_owed boolean not null default false;
alter table jobs add column if not exists cancellation_fee_charged boolean not null default false;

-- 4. Discount / promo codes (built but NOT activated in the UI yet) -----------
create table if not exists discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  percent_off int, -- e.g. 10, 20, 30
  waive_service_fee boolean not null default false, -- launch promo: 100% off the $12 fee
  max_uses int, -- null = unlimited
  uses_count int not null default 0,
  active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table jobs add column if not exists discount_code_id uuid references discount_codes(id);

-- 5. Post-delivery feedback / complaints ---------------------------------------
create table if not exists job_feedback (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  buyer_id uuid not null references profiles(id) on delete cascade,
  rating int check (rating between 1 and 5),
  comment text,
  is_complaint boolean not null default false,
  created_at timestamptz not null default now()
);

alter table job_feedback enable row level security;

drop policy if exists "Buyers can create feedback on own jobs" on job_feedback;
create policy "Buyers can create feedback on own jobs" on job_feedback
  for insert with check (
    buyer_id = auth.uid() and exists (
      select 1 from jobs j where j.id = job_feedback.job_id and j.buyer_id = auth.uid()
    )
  );

drop policy if exists "Buyers can read own feedback" on job_feedback;
create policy "Buyers can read own feedback" on job_feedback
  for select using (buyer_id = auth.uid());

-- 6. Contact Us / general site feedback ----------------------------------------
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  message text not null,
  created_at timestamptz not null default now()
);

alter table contact_messages enable row level security;

drop policy if exists "Anyone can submit contact message" on contact_messages;
create policy "Anyone can submit contact message" on contact_messages
  for insert with check (true);

-- ============================================================================
-- End of migration_003
-- ============================================================================
