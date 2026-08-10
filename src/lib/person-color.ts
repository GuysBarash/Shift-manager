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
