-- Usage/traffic log. Answers "who is actually using the app, and when".
--
-- Why this logs visits and not just logins: the demo name-gate stores its
-- cookie for 365 days (COOKIE_DAYS in src/lib/demo-identity.tsx), so a person
-- types their name once and effectively never "logs in" again. A login-only
-- log would therefore be nearly empty and would say nothing about traffic.
-- So the app records:
--   'login'  — the name gate was submitted successfully (rare, by design)
--   'visit'  — the app was opened/resumed by an already-identified person.
--              Debounced client-side to at most one row per 30 minutes per
--              device (SESSION_GAP_MS in src/lib/activity.ts), so this is
--              roughly "one row per session" rather than one per page view.
--   'switch' — someone used "החלפת שם" to become a different person.
--
-- There is deliberately no UI for any of this; query it from the Supabase SQL
-- editor using the two views at the bottom.

create table public.user_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('login', 'visit', 'switch')),
  occurred_at timestamptz not null default now(),
  -- Raw UA string. Kept for coarse device/browser breakdown only; nothing in
  -- the app parses it.
  user_agent text,
  -- Which page the app was opened on.
  path text,
  -- 'standalone' when running as the installed PWA, 'browser' in a tab. This
  -- is what tells you whether the install flow is actually being used.
  display_mode text
);

-- Traffic queries are almost always "recent activity, newest first", either
-- across everyone or scoped to one person.
create index user_activity_occurred_at_idx on public.user_activity (occurred_at desc);
create index user_activity_user_idx on public.user_activity (user_id, occurred_at desc);

alter table public.user_activity enable row level security;

-- Deliberately INSERT-only for the app's roles: the client needs to append
-- events, but nothing in the app reads them back, and a usage log covering
-- everyone shouldn't be readable by any anonymous caller that can hit the
-- REST API. Reads happen in the SQL editor (service_role/postgres bypasses
-- RLS). Note supabase-js only issues a SELECT after an insert if you chain
-- .select() — src/lib/activity.ts deliberately does not.
create policy "user_activity_insert_all" on public.user_activity
  for insert to authenticated with check (true);
create policy "demo_user_activity_insert_all" on public.user_activity
  for insert to anon with check (true);

grant insert on public.user_activity to authenticated;
grant insert on public.user_activity to anon;

-- ---------- reporting views (query these in the SQL editor) ----------

-- Who was last seen when, and how much have they used the app.
create view public.user_last_seen as
  select
    p.id as user_id,
    p.full_name,
    count(a.id) filter (where a.event_type = 'visit') as visit_count,
    max(a.occurred_at) as last_seen_at,
    min(a.occurred_at) as first_seen_at
  from public.profiles p
  left join public.user_activity a on a.user_id = p.id
  group by p.id, p.full_name;

-- Daily traffic: distinct people and total sessions per day.
create view public.user_activity_daily as
  select
    (occurred_at at time zone 'Asia/Jerusalem')::date as day,
    count(*) filter (where event_type = 'visit') as visits,
    count(distinct user_id) filter (where event_type = 'visit') as distinct_users,
    count(*) filter (where event_type = 'login') as logins,
    count(*) filter (where display_mode = 'standalone') as installed_app_events
  from public.user_activity
  group by 1
  order by 1 desc;
