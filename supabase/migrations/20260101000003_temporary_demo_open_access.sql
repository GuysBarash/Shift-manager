-- TEMPORARY DEMO MODE — for showing people the app without real accounts.
-- Opens the database to anonymous access and lets "people" exist without a
-- matching auth.users row, so a free-text name entry can create one on the
-- spot. Everything here is additive and easy to revert before a real launch:
--   1. drop every policy/grant added below (all prefixed "demo_" or granted
--      to `anon`)
--   2. re-add the FK: alter table public.profiles
--        add constraint profiles_id_fkey foreign key (id)
--        references auth.users(id) on delete cascade;
-- The original `authenticated`-role policies from earlier migrations are
-- untouched, so real magic-link login still works underneath this.

alter table public.profiles drop constraint profiles_id_fkey;

grant usage on schema public to anon;
grant select, insert, update on public.profiles to anon;
grant select, insert, update, delete on public.shifts to anon;
grant select, insert, update on public.shift_audit to anon;
grant select, insert, update, delete on public.time_off to anon;

create policy "demo_profiles_select_all" on public.profiles for select to anon using (true);
create policy "demo_profiles_insert_all" on public.profiles for insert to anon with check (true);
create policy "demo_profiles_update_all" on public.profiles for update to anon using (true) with check (true);

create policy "demo_shifts_select_all" on public.shifts for select to anon using (true);
create policy "demo_shifts_insert_all" on public.shifts for insert to anon with check (true);
create policy "demo_shifts_update_all" on public.shifts for update to anon using (true) with check (true);
create policy "demo_shifts_delete_all" on public.shifts for delete to anon using (true);

create policy "demo_shift_audit_select_all" on public.shift_audit for select to anon using (true);
create policy "demo_shift_audit_insert_all" on public.shift_audit for insert to anon with check (true);
create policy "demo_shift_audit_update_all" on public.shift_audit for update to anon using (true) with check (true);

create policy "demo_time_off_select_all" on public.time_off for select to anon using (true);
create policy "demo_time_off_insert_all" on public.time_off for insert to anon with check (true);
create policy "demo_time_off_update_all" on public.time_off for update to anon using (true) with check (true);
create policy "demo_time_off_delete_all" on public.time_off for delete to anon using (true);
