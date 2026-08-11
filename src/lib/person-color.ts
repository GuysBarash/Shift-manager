// Distinct accent color per person. Defaults to a deterministic hash of their
// id (stable across reloads with no setup needed), but a person can override
// it with an explicit pick from the same palette (see Profile.color).
export const PALETTE = [
  { name: "red", hex: "#f87171" },
  { name: "orange", hex: "#fb923c" },
  { name: "amber", hex: "#fbbf24" },
  { name: "yellow", hex: "#fde047" },
  { name: "lime", hex: "#a3e635" },
  { name: "green", hex: "#4ade80" },
  { name: "emerald", hex: "#34d399" },
  { name: "teal", hex: "#2dd4bf" },
  { name: "cyan", hex: "#22d3ee" },
  { name: "sky", hex: "#38bdf8" },
  { name: "blue", hex: "#60a5fa" },
  { name: "indigo", hex: "#818cf8" },
  { name: "violet", hex: "#a78bfa" },
  { name: "fuchsia", hex: "#e879f9" },
  { name: "magenta", hex: "#f472b6" },
  { name: "rose", hex: "#fb7185" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function personColor(id: string | null | undefined, colorKey?: string | null) {
  if (colorKey) {
    const explicit = PALETTE.find((c) => c.name === colorKey);
    if (explicit) return explicit;
  }
  if (!id) return null;
  const index = hashString(id) % PALETTE.length;
  return PALETTE[index];
}

type ColorablePerson = { id: string; color: string | null; sambatz: boolean; full_name: string | null };

// Coordinated coloring across a group: Sambatz people (without an explicit
// pick) are spread as evenly as possible around the palette's hue wheel so
// they stay visually distinct from each other at a glance on the schedule;
// everyone else just falls back to the plain per-id hash — fine for them
// since they're not competing for attention in the same grid.
export function buildColorAssignments(people: ColorablePerson[]): Map<string, { name: string; hex: string }> {
  const map = new Map<string, { name: string; hex: string }>();

  for (const p of people) {
    if (p.color) {
      const explicit = PALETTE.find((c) => c.name === p.color);
      if (explicit) map.set(p.id, explicit);
    }
  }

  const sambatzToAssign = people
    .filter((p) => p.sambatz && !map.has(p.id))
    .sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? ""));
  sambatzToAssign.forEach((p, i) => {
    const index = Math.floor((i * PALETTE.length) / sambatzToAssign.length) % PALETTE.length;
    map.set(p.id, PALETTE[index]);
  });

  for (const p of people) {
    if (!map.has(p.id)) {
      map.set(p.id, PALETTE[hashString(p.id) % PALETTE.length]);
    }
  }

  return map;
}
