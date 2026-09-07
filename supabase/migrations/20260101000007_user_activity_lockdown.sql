-- Closes two holes left by 20260101000006_user_activity.sql, which assumed
-- RLS alone would keep the traffic log private. It doesn't, for two reasons:
--
-- 1. Supabase grants ALL privileges on new public-schema tables to `anon` and
--    `authenticated` via ALTER DEFAULT PRIVILEGES, so that migration's
--    `grant insert` was a no-op on top of an already-wide grant. RLS still
--    blocked reads (there is no SELECT policy), but TRUNCATE is NOT subject to
--    RLS at all, so the grant itself has to go.
--
-- 2. Worse: `user_last_seen` and `user_activity_daily` are plain views, so
--    they execute as their OWNER (postgres) and bypass the base table's RLS
--    completely — and default privileges had granted SELECT on them to `anon`.
--    Anyone holding the public anon key (it ships in the client bundle) could
--    read the whole usage log through them. Verified against the live project
--    before writing this.
--
-- These views are for querying in the SQL editor, where service_role/postgres
-- bypasses RLS anyway, so no client role needs access to them at all.

revoke all on public.user_last_seen from anon, authenticated;
revoke all on public.user_activity_daily from anon, authenticated;

-- Append-only for the app: it writes events and never reads them back.
revoke all on public.user_activity from anon, authenticated;
grant insert on public.user_activity to anon, authenticated;
