import { addDays } from "./dates";
import type { Profile, TimeOff } from "@/types/database";

export const TIME_OFF_COLOR = "rgba(148, 163, 184, 0.35)";

export function isAdmin(profiles: Profile[], userId: string): boolean {
  return profiles.find((p) => p.id === userId)?.is_admin ?? false;
}

// Only Sambatz actually get scheduled — this scoping is shared by the
// shifts paint palette, the off-time grid, and anywhere else that only
// cares about schedulable people.
export function sambatzProfiles(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => p.sambatz);
}

// The other half of the roster — everyone shown with the קצין badge on
// the People page (i.e. not Sambatz). Same binary split, opposite set.
export function officerProfiles(profiles: Profile[]): Profile[] {
  return profiles.filter((p) => !p.sambatz);
}

export function isSambatz(profiles: Profile[], userId: string): boolean {
  return profiles.some((p) => p.id === userId && p.sambatz);
}

export function buildTimeOffIndex(entries: TimeOff[]): Map<string, TimeOff[]> {
  const map = new Map<string, TimeOff[]>();
  entries.forEach((t) => {
    const list = map.get(t.user_id) ?? [];
    list.push(t);
    map.set(t.user_id, list);
  });
  return map;
}

export function isOnTimeOff(index: Map<string, TimeOff[]>, personId: string, dateIso: string): boolean {
  const list = index.get(personId);
  if (!list) return false;
  return list.some((t) => t.start_date <= dateIso && dateIso <= t.end_date);
}

export function buildDateRange(start: Date, days: number): Date[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

// The roster's real command structure, in the order it appears in the
// source roster spreadsheet. "מבצעים" is included alongside 'סמב"צ' because
// older seeded rows use that label for the same category — both mean the
// same group of people.
export const ROLE_GROUPS: { label: string; roles: string[] }[] = [
  { label: "פיקוד", roles: ["מפקד מכלול", "ס.מפקד מכלול"] },
  { label: 'קמב"צ', roles: ['קמב"צ'] },
  { label: "קש״א", roles: ["קש״א"] },
  { label: "קמן", roles: ["קמן"] },
  { label: 'סמב"צ', roles: ['סמב"צ', "מבצעים"] },
  { label: "אש", roles: ["אש"] },
  { label: "מודיעין", roles: ["מודיעין"] },
];

// Splits a roster into its command-structure categories, preserving
// ROLE_GROUPS order and each group's incoming relative order. Anyone whose
// role doesn't match a known category (e.g. left blank) still shows up,
// grouped together at the end, instead of silently disappearing.
export function groupProfilesByRole<T extends { role: string | null }>(
  profiles: T[]
): { label: string; members: T[] }[] {
  const grouped = new Set<T>();
  const groups = ROLE_GROUPS.map((g) => {
    const members = profiles.filter((p) => g.roles.includes(p.role ?? ""));
    members.forEach((p) => grouped.add(p));
    return { label: g.label, members };
  });
  const rest = profiles.filter((p) => !grouped.has(p));
  if (rest.length > 0) groups.push({ label: "אחר", members: rest });
  return groups.filter((g) => g.members.length > 0);
}
