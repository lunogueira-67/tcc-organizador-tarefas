-- Backend do cronograma compartilhado do TCC.
-- Execute como uma migracao em um projeto Supabase dedicado.

create table if not exists public.tcc_boards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  title text not null check (char_length(title) between 3 and 160),
  created_at timestamptz not null default now()
);

create table if not exists public.tcc_board_members (
  board_id uuid not null references public.tcc_boards(id) on delete cascade,
  email text not null check (email = lower(btrim(email)) and char_length(email) between 5 and 254),
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (board_id, email)
);

create table if not exists public.tcc_task_progress (
  board_id uuid not null references public.tcc_boards(id) on delete cascade,
  task_id text not null check (task_id ~ '^[a-z0-9_]{3,64}$'),
  completed boolean not null default false,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (board_id, task_id)
);

create table if not exists public.tcc_board_settings (
  board_id uuid primary key references public.tcc_boards(id) on delete cascade,
  person1_name text not null check (char_length(person1_name) between 1 and 80),
  person2_name text not null check (char_length(person2_name) between 1 and 80),
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index if not exists tcc_task_progress_updated_by_idx
on public.tcc_task_progress (updated_by);

create index if not exists tcc_board_settings_updated_by_idx
on public.tcc_board_settings (updated_by);

create or replace function public.tcc_set_audit_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.tcc_set_audit_fields() from public, anon, authenticated;

drop trigger if exists tcc_task_progress_audit on public.tcc_task_progress;
create trigger tcc_task_progress_audit
before insert or update on public.tcc_task_progress
for each row execute function public.tcc_set_audit_fields();

drop trigger if exists tcc_board_settings_audit on public.tcc_board_settings;
create trigger tcc_board_settings_audit
before insert or update on public.tcc_board_settings
for each row execute function public.tcc_set_audit_fields();

alter table public.tcc_boards enable row level security;
alter table public.tcc_board_members enable row level security;
alter table public.tcc_task_progress enable row level security;
alter table public.tcc_board_settings enable row level security;

alter table public.tcc_boards force row level security;
alter table public.tcc_board_members force row level security;
alter table public.tcc_task_progress force row level security;
alter table public.tcc_board_settings force row level security;

revoke all on table public.tcc_boards from public, anon;
revoke all on table public.tcc_board_members from public, anon;
revoke all on table public.tcc_task_progress from public, anon;
revoke all on table public.tcc_board_settings from public, anon;

grant usage on schema public to authenticated;
grant select on table public.tcc_boards to authenticated;
grant select on table public.tcc_board_members to authenticated;
grant select, insert, update on table public.tcc_task_progress to authenticated;
grant select, insert, update on table public.tcc_board_settings to authenticated;

drop policy if exists "members_select_own_membership" on public.tcc_board_members;
create policy "members_select_own_membership"
on public.tcc_board_members
for select
to authenticated
using (email = lower((select auth.jwt() ->> 'email')));

drop policy if exists "members_select_board" on public.tcc_boards;
create policy "members_select_board"
on public.tcc_boards
for select
to authenticated
using (
  exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_boards.id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

drop policy if exists "members_select_progress" on public.tcc_task_progress;
create policy "members_select_progress"
on public.tcc_task_progress
for select
to authenticated
using (
  exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_task_progress.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

drop policy if exists "members_insert_progress" on public.tcc_task_progress;
create policy "members_insert_progress"
on public.tcc_task_progress
for insert
to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_task_progress.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

drop policy if exists "members_update_progress" on public.tcc_task_progress;
create policy "members_update_progress"
on public.tcc_task_progress
for update
to authenticated
using (
  exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_task_progress.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_task_progress.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

drop policy if exists "members_select_settings" on public.tcc_board_settings;
create policy "members_select_settings"
on public.tcc_board_settings
for select
to authenticated
using (
  exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_board_settings.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

drop policy if exists "members_insert_settings" on public.tcc_board_settings;
create policy "members_insert_settings"
on public.tcc_board_settings
for insert
to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_board_settings.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

drop policy if exists "members_update_settings" on public.tcc_board_settings;
create policy "members_update_settings"
on public.tcc_board_settings
for update
to authenticated
using (
  exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_board_settings.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1
    from public.tcc_board_members member
    where member.board_id = tcc_board_settings.board_id
      and member.email = lower((select auth.jwt() ->> 'email'))
  )
);

insert into public.tcc_boards (slug, title)
values ('tcc-organizador-tarefas', 'Organizador do TCC - Fraude Pix')
on conflict (slug) do update set title = excluded.title;

do $$
begin
  alter publication supabase_realtime add table public.tcc_task_progress;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.tcc_board_settings;
exception when duplicate_object then null;
end $$;
