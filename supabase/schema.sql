-- ═══════════════════════════════════════════════════════════════════════════════
-- VanGo — Database Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════════════════

-- Enable PostGIS for location queries (nearest driver matching)
create extension if not exists postgis;

-- ── profiles ──────────────────────────────────────────────────────────────────
-- Extends Supabase auth.users with app-specific fields
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  phone       text not null,
  role        text not null check (role in ('buyer','driver','admin')),
  created_at  timestamptz default now()
);

-- Auto-create a profile row when a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'role', 'buyer')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── drivers ──────────────────────────────────────────────────────────────────
create table public.drivers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  vehicle_type    text not null check (vehicle_type in ('ute','van','truck')),
  vehicle_make    text not null,
  vehicle_model   text not null,
  vehicle_plate   text not null,
  is_online       boolean default false,
  current_lat     double precision,
  current_lng     double precision,
  location        geography(Point, 4326),  -- PostGIS point for distance queries
  rating          numeric(3,2) default 5.0,
  total_jobs      int default 0,
  created_at      timestamptz default now()
);

create index drivers_location_idx on public.drivers using gist(location);

create table public.jobs (
  id                      uuid primary key default gen_random_uuid(),
  buyer_id                uuid not null references public.profiles(id),
  driver_id               uuid references public.drivers(id),
  item_type               text not null,
  item_description        text not null,
  item_size               text not null check (item_size in ('medium','large','xlarge')),
  helpers_needed          int not null default 1,
  photo_url               text,
  pickup_address          text not null,
  pickup_lat              double precision not null,
  pickup_lng              double precision not null,
  dropoff_address         text not null,
  dropoff_lat             double precision not null,
  dropoff_lng             double precision not null,
  scheduled_for           timestamptz,
  status                  text not null default 'pending' check (status in ('pending','accepted','picked_up','delivered','cancelled')),
  driver_fee              numeric(8,2) not null,
  service_fee             numeric(8,2) not null default 12.00,
  stripe_payment_intent_id text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create or replace function public.update_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create trigger jobs_updated_at before update on public.jobs for each row execute procedure public.update_updated_at();

create table public.job_status_events (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  status      text not null,
  note        text,
  created_at  timestamptz default now()
);

alter table public.profiles          enable row level security;
alter table public.drivers           enable row level security;
alter table public.jobs              enable row level security;
alter table public.job_status_events enable row level security;

create policy "Users can read own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
create policy "Authenticated can read online drivers" on public.drivers for select to authenticated using (is_online = true or user_id = auth.uid());
create policy "Drivers can update own record" on public.drivers for update using (user_id = auth.uid());
create policy "Buyers see own jobs" on public.jobs for select using (buyer_id = auth.uid());
create policy "Drivers see pending or own jobs" on public.jobs for select using (status = 'pending' or driver_id in (select id from public.drivers where user_id = auth.uid()));
create policy "Buyers can create jobs" on public.jobs for insert to authenticated with check (buyer_id = auth.uid());
create policy "Drivers can update jobs" on public.jobs for update using (driver_id in (select id from public.drivers where user_id = auth.uid()) or status = 'pending');
create policy "Job participants can read events" on public.job_status_events for select using (job_id in (select id from public.jobs where buyer_id = auth.uid() or driver_id in (select id from public.drivers where user_id = auth.uid())));

alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_status_events;
