-- Drop the unused "reason" field from time_off.
alter table public.time_off drop column reason;

-- Let people override their auto-assigned display color. Null means
-- "use the deterministic hash-based color" (see src/lib/person-color.ts);
-- a non-null value is an explicit pick from the same palette.
alter table public.profiles add column color text;
