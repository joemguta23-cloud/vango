-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 001 — Multi-item jobs + helper fields + distance zone
-- Run this in Supabase SQL Editor AFTER running schema.sql
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.jobs
  add column if not exists items jsonb not null default '[]'::jsonb;

alter table public.jobs
  add column if not exists helper_at_pickup  boolean not null default false,
  add column if not exists helper_at_dropoff boolean not null default false,
  add column if not exists helper_note       text;

alter table public.jobs
  add column if not exists distance_zone text not null default 'under_15'
    check (distance_zone in ('under_15','15_to_30','30_to_50','over_50'));
