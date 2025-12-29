alter table public.imports add column if not exists ready boolean not null default false;
alter table public.imports add column if not exists stage text not null default 'indexing';
alter table public.imports add column if not exists archived_count int not null default 0;
