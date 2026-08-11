-- Closed roster: the app is no longer open self-registration. Only the 26
-- named people seeded below may log in — src/lib/demo-identity.tsx now
-- rejects any name that doesn't match an existing profile instead of
-- creating one. "sambatz" marks who can actually be assigned to shifts
-- (the paint palette on the shifts page only lists sambatz=true people);
-- everyone else is roster-only (e.g. for visibility/off-time later).
-- גיא ברש is seeded as the sole admin (is_admin), which gates the
-- sambatz toggle on the People page.

-- Loosen these two FKs to match shifts.assigned_to's existing
-- on-delete-set-null behavior, so clearing the old demo roster below isn't
-- blocked by old rows still pointing at a deleted profile.
alter table public.shifts drop constraint shifts_created_by_fkey;
alter table public.shifts add constraint shifts_created_by_fkey
  foreign key (created_by) references public.profiles(id) on delete set null;

alter table public.shift_audit drop constraint shift_audit_changed_by_fkey;
alter table public.shift_audit add constraint shift_audit_changed_by_fkey
  foreign key (changed_by) references public.profiles(id) on delete set null;

alter table public.profiles add column sambatz boolean not null default false;
alter table public.profiles add column is_admin boolean not null default false;

-- No more free-text self-registration — only the seeded roster may log in.
drop policy "demo_profiles_insert_all" on public.profiles;

delete from public.profiles;

insert into public.profiles (id, full_name, sambatz, is_admin) values
  (gen_random_uuid(), 'רואי בוקריס', false, false),
  (gen_random_uuid(), 'יואב רוזנברג', false, false),
  (gen_random_uuid(), 'רועי ארביב', false, false),
  (gen_random_uuid(), 'איתי שקד', false, false),
  (gen_random_uuid(), 'תומי פטמן', false, false),
  (gen_random_uuid(), 'ליאור בן שושן', false, false),
  (gen_random_uuid(), 'ניר מזרחי', false, false),
  (gen_random_uuid(), 'נדב מינסקי', false, false),
  (gen_random_uuid(), 'אילן סימון', false, false),
  (gen_random_uuid(), 'אופיר ביגאוי', false, false),
  (gen_random_uuid(), 'גיא מנחם', false, false),
  (gen_random_uuid(), 'אורי מויאל', false, false),
  (gen_random_uuid(), 'עומר גדיש', true, false),
  (gen_random_uuid(), 'יניר מזרחי', true, false),
  (gen_random_uuid(), 'ידידה פויכטנגר', true, false),
  (gen_random_uuid(), 'אורן הירשהורן', true, false),
  (gen_random_uuid(), 'גיא ברש', true, true),
  (gen_random_uuid(), 'אלון קלנגל', true, false),
  (gen_random_uuid(), 'אביב אגוזי', true, false),
  (gen_random_uuid(), 'יפית בלגזאל', true, false),
  (gen_random_uuid(), 'אילון אביאור', true, false),
  (gen_random_uuid(), 'חיים כהן', true, false),
  (gen_random_uuid(), 'עזרא פינקל', true, false),
  (gen_random_uuid(), 'אלישיב מרמור', true, false),
  (gen_random_uuid(), 'יאיר נגר', true, false),
  (gen_random_uuid(), 'נריה יעקב', true, false);
