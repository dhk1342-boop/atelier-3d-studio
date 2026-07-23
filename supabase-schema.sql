create table if not exists public.shared_scenes (
  id text primary key,
  name text not null,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.shared_scenes enable row level security;

drop policy if exists "public read shared scenes" on public.shared_scenes;
create policy "public read shared scenes"
on public.shared_scenes
for select
using (true);

drop policy if exists "public insert shared scenes" on public.shared_scenes;
create policy "public insert shared scenes"
on public.shared_scenes
for insert
with check (true);

drop policy if exists "public update shared scenes" on public.shared_scenes;
create policy "public update shared scenes"
on public.shared_scenes
for update
using (true)
with check (true);
