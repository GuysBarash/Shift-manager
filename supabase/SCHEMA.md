# Database Schema

Source of truth: the files in [`migrations/`](migrations). This file is a human-readable summary — if they ever disagree, the migrations win.

> **⚠️ Temporary demo mode is currently active** (migration `20260101000003_temporary_demo_open_access.sql`).
> The database is open to anonymous (`anon`) access and `profiles.id` no longer requires a matching
> `auth.users` row, so the app can run on a cookie-based name picker (`src/lib/demo-identity.tsx`)
> instead of real login. Real Supabase Auth (magic link) still works underneath — see that
> migration's header comment for exact revert steps before a real launch, and also restore
> `src/proxy.ts` (currently bypasses the auth redirect) and re-wire the pages that use
> `useDemoIdentity()` back to `supabase.auth.getUser()`.
>
> On top of that, `20260101000004_named_roster_sambatz.sql` closes the roster: only the 26
> people seeded there may log in (matched by exact name — `demo_profiles_insert_all` was
> dropped, so no one else can self-register). Note the `sambatz`/`is_admin` **update** RLS is
> still the wide-open demo policy — the People page hides the toggle from non-admins, but
> nothing stops a raw API call from flipping it. Fine for a demo; tighten before a real launch.

## Entity overview

```
auth.users (managed by Supabase Auth)
    │ 1:1 (trigger-created on signup)
    ▼
profiles ──┬──< shifts.assigned_to
           ├──< shifts.created_by
           ├──< time_off.user_id
           └──< shift_audit.changed_by

shifts ──< shift_audit.shift_id  (snapshotted before every update/delete)
```

## Tables

### `profiles`
One row per person. Currently a closed, hand-seeded roster of 26 (see warning above) rather than auto-created via login.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK; normally FK → `auth.users(id)` cascading on delete — **temporarily dropped** for demo mode, see warning above |
| `full_name` | `text` | nullable; the closed-roster login matches on this exactly (case-insensitive) |
| `phone` | `text` | nullable |
| `color` | `text` | nullable, explicit palette pick (see `src/lib/person-color.ts`); `null` = auto-assigned via hash of `id` |
| `sambatz` | `boolean` | not null, default `false`; only sambatz=true people can be assigned to shifts (the paint palette and extended table on the shifts page are scoped to them) — editable per-person on the People page, admin-only |
| `is_admin` | `boolean` | not null, default `false`; gates the sambatz toggle on the People page. Seeded true only for גיא ברש |
| `created_at` | `timestamptz` | default `now()` |

### `shifts`
The core schedule. Self-service: any logged-in user can create/edit/delete any shift.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `shift_date` | `date` | not null |
| `start_time` | `time` | not null |
| `end_time` | `time` | not null |
| `position` | `text` | nullable; the app only ever writes one of the two fixed values in `SHIFT_COLUMNS` (`src/app/(app)/page.tsx`) — a free column name isn't otherwise meaningful anymore |
| `assigned_to` | `uuid` | nullable FK → `profiles.id`, `on delete set null` |
| `notes` | `text` | nullable |
| `created_by` | `uuid` | FK → `profiles.id` |
| `updated_at` | `timestamptz` | default `now()` |

Indexed on `shift_date`.

### `shift_audit`
Undo log. A trigger snapshots the row **before** every update/delete on `shifts`, so a change can be reverted.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `shift_id` | `uuid` | the shift that changed (no FK — row may already be gone) |
| `changed_by` | `uuid` | FK → `profiles.id`, whoever made the change (`auth.uid()`) |
| `change_type` | `text` | `'update'` or `'delete'` |
| `old_value` | `jsonb` | full snapshot of the row before the change |
| `changed_at` | `timestamptz` | default `now()` |
| `undone` | `boolean` | default `false`, set `true` once someone undoes this entry |

Indexed on `changed_at desc` (activity feed is most-recent-first).

Inserts are not audited — only updates/deletes — since there's nothing to "undo" a creation back to.

### `time_off`
Date ranges a person has marked themselves unavailable (vacation, sick, etc.). Everyone can view; each person manages only their own rows.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `user_id` | `uuid` | FK → `profiles.id`, `on delete cascade` |
| `start_date` | `date` | not null |
| `end_date` | `date` | not null, `check (end_date >= start_date)` |
| `created_at` | `timestamptz` | default `now()` |

Indexed on `user_id`.

## Triggers & functions

- **`handle_new_user()`** — `after insert on auth.users` → inserts a matching `profiles` row (`full_name` defaults to the invite email if none is set).
- **`log_shift_change()`** — `before update or delete on public.shifts` → inserts a snapshot into `shift_audit`. Runs as `security definer` so it can write regardless of the caller's own permissions.

## Row-Level Security summary

Every table has RLS enabled. The table below is the original design (all policies require `authenticated`); demo mode currently layers matching `anon`-role policies on top of every table (fully open, no ownership checks) — see the warning above.

| Table | Select | Insert | Update | Delete |
|---|---|---|---|---|
| `profiles` | anyone | — (via trigger only) | own row only | — |
| `shifts` | anyone | anyone | anyone | anyone |
| `shift_audit` | anyone | anyone | anyone (used to flip `undone`) | — |
| `time_off` | anyone | own rows only | own rows only | own rows only |

`shifts` is intentionally wide-open for writes (self-service editing per the product design) — safety net is the `shift_audit` undo log, not restricted permissions.
