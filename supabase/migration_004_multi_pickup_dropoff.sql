-- ============================================================================
-- VanGo migration_004: multi-pickup / multi-dropoff support
-- Adds an optional 2nd pickup and/or 2nd dropoff address to a job, at a
-- heavily discounted flat add-on fee (EXTRA_STOP_FEE in lib/pricing.ts)
-- versus booking two completely separate jobs, since the driver is already
-- en route.
-- Run this in Supabase Dashboard -> SQL Editor -> New Query -> Run
-- Status: already run against production on 2026-07-01.
-- ============================================================================

alter table jobs add column if not exists second_pickup_address text;
alter table jobs add column if not exists second_pickup_lat double precision;
alter table jobs add column if not exists second_pickup_lng double precision;

alter table jobs add column if not exists second_dropoff_address text;
alter table jobs add column if not exists second_dropoff_lat double precision;
alter table jobs add column if not exists second_dropoff_lng double precision;

alter table jobs add column if not exists extra_stops_fee numeric not null default 0;

-- ============================================================================
-- End of migration_004
-- ============================================================================
