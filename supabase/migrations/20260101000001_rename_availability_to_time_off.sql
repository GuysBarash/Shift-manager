-- Rename availability -> time_off to match the app's "Off-time" tab.
alter table public.availability rename to time_off;

alter index availability_user_idx rename to time_off_user_idx;
alter table public.time_off rename constraint availability_date_order to time_off_date_order;

alter policy "availability_select_all" on public.time_off rename to "time_off_select_all";
alter policy "availability_insert_own" on public.time_off rename to "time_off_insert_own";
alter policy "availability_update_own" on public.time_off rename to "time_off_update_own";
alter policy "availability_delete_own" on public.time_off rename to "time_off_delete_own";
