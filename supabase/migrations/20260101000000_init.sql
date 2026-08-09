-- Shift Manager schema: profiles, shifts, shift_audit (undo log), availability.
-- Run this once in the Supabase SQL editor for a new project.

create extension if not exists pgcrypto;

-- Table-level grants: RLS policies below control *which rows* are visible/writable,
-- but Postgres also requires a base grant before RLS is even consulted. Hosted
-- Supabase projects set this up automatically during provisioning; a bare local
-- Postgres (via the CLI) does not, so it's granted explicitly here for portability.
grant usage on schema public to authenticated;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_all" on public.profiles
  for select to authenticated using (true);

create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

grant select, update on public.profiles to authenticated;

-- Auto-create a profile row whenever a new auth user is invited/confirmed.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- shifts ----------
create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null,
  start_time time not null,
  end_time time not null,
  position text,
  assigned_to uuid references public.profiles(id) on delete set null,
  notes text,
  created_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index shifts_date_idx on public.shifts (shift_date);

alter table public.shifts enable row level security;

-- Self-service editing: any logged-in friend can create/edit/delete any shift.
create policy "shifts_select_all" on public.shifts for select to authenticated using (true);
create policy "shifts_insert_all" on public.shifts for insert to authenticated with check (true);
create policy "shifts_update_all" on public.shifts for update to authenticated using (true) with check (true);
create policy "shifts_delete_all" on public.shifts for delete to authenticated using (true);

grant select, insert, update, delete on public.shifts to authenticated;

-- ---------- shift_audit (undo log) ----------
create table public.shift_audit (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null,
  changed_by uuid references public.profiles(id),
  change_type text not null check (change_type in ('update', 'delete')),
  old_value jsonb not null,
  changed_at timestamptz not null default now(),
  undone boolean not null default false
);

create index shift_audit_changed_at_idx on public.shift_audit (changed_at desc);

alter table public.shift_audit enable row level security;

create policy "shift_audit_select_all" on public.shift_audit for select to authenticated using (true);
create policy "shift_audit_insert_all" on public.shift_audit for insert to authenticated with check (true);
create policy "shift_audit_update_all" on public.shift_audit for update to authenticated using (true) with check (true);

grant select, insert, update on public.shift_audit to authenticated;

-- Snapshot the row before every update/delete so it can be restored ("undo").
create or replace function public.log_shift_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if (tg_op = 'UPDATE') then
    insert into public.shift_audit (shift_id, changed_by, change_type, old_value)
    values (old.id, auth.uid(), 'update', to_jsonb(old));
    return new;
  elsif (tg_op = 'DELETE') then
    insert into public.shift_audit (shift_id, changed_by, change_type, old_value)
    values (old.id, auth.uid(), 'delete', to_jsonb(old));
    return old;
  end if;
  return null;
end;
$$;

create trigger shifts_audit_before_change
  before update or delete on public.shifts
  for each row execute function public.log_shift_change();

-- ---------- availability ----------
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  created_at timestamptz not null default now(),
  constraint availability_date_order check (end_date >= start_date)
);

create index availability_user_idx on public.availability (user_id);

alter table public.availability enable row level security;

create policy "availability_select_all" on public.availability for select to authenticated using (true);
create policy "availability_insert_own" on public.availability for insert to authenticated with check (user_id = auth.uid());
create policy "availability_update_own" on public.availability for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "availability_delete_own" on public.availability for delete to authenticated using (user_id = auth.uid());

grant select, insert, update, delete on public.availability to authenticated;
