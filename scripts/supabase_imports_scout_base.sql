-- Adds Scout Base (3-year window) metadata to imports

alter table public.imports
  add column if not exists scout_base_since timestamptz null;

alter table public.imports
  add column if not exists scout_base_count int null;

alter table public.imports
  add column if not exists scout_base_fallback boolean not null default false;

alter table public.imports
  add column if not exists scout_base_fallback_limit int not null default 100;
