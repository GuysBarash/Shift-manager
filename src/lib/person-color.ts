// Deterministic, distinct accent color per person — derived from their id so it's
// stable across reloads without needing a dedicated color column in the database.
const PALETTE = [
  { name: "green", hex: "#4ade80", ring: "oklch(0.8 0.19 150)" },
  { name: "cyan", hex: "#22d3ee", ring: "oklch(0.78 0.14 200)" },
  { name: "amber", hex: "#fbbf24", ring: "oklch(0.8 0.16 85)" },
  { name: "magenta", hex: "#f472b6", ring: "oklch(0.72 0.19 340)" },
  { name: "violet", hex: "#a78bfa", ring: "oklch(0.72 0.19 290)" },
  { name: "orange", hex: "#fb923c", ring: "oklch(0.75 0.18 45)" },
  { name: "sky", hex: "#38bdf8", ring: "oklch(0.78 0.13 230)" },
  { name: "lime", hex: "#a3e635", ring: "oklch(0.85 0.19 125)" },
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export function personColor(id: string | null | undefined) {
  if (!id) return null;
  const index = hashString(id) % PALETTE.length;
  return PALETTE[index];
}
