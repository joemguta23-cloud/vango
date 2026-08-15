-- Driver push notification opt-out.
-- Default TRUE: notifications are ON unless a driver explicitly turns them off.

alter table drivers
  add column if not exists push_enabled boolean not null default true;

-- Existing drivers keep notifications on.
update drivers set push_enabled = true where push_enabled is null;

comment on column drivers.push_enabled is
  'When false the driver receives no native job push. Default true.';
