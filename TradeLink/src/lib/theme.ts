import { Candy, Droplets, HardHat, Milk, Package, SprayCan, Wheat, Wrench, type LucideIcon } from "lucide-react";

/** A category's own look: two colours, a tint, a dark ink, a repeating pattern and an icon. */
export type Look = { key: string; a: string; b: string; tint: string; ink: string; pat: string; Icon: LucideIcon };

type Kind = "grain" | "crystal" | "drop" | "bubble" | "brick" | "wave" | "dots" | "grid";

const shapes: Record<Kind, (c: string) => string> = {
  grain: c => `<g fill="${c}"><ellipse cx="14" cy="16" rx="3" ry="7" transform="rotate(-35 14 16)"/><ellipse cx="46" cy="22" rx="3" ry="7" transform="rotate(30 46 22)"/><ellipse cx="30" cy="48" rx="3" ry="7" transform="rotate(-10 30 48)"/></g>`,
  crystal: c => `<g fill="none" stroke="${c}" stroke-width="2"><path d="M14 6l8 8-8 8-8-8z"/><path d="M46 30l6 6-6 6-6-6z"/><path d="M20 46l5 5-5 5-5-5z"/></g>`,
  drop: c => `<g fill="${c}"><path d="M16 6c5 7 8 11 8 15a8 8 0 0 1-16 0c0-4 3-8 8-15z"/><path d="M46 34c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11z"/></g>`,
  bubble: c => `<g fill="none" stroke="${c}" stroke-width="2"><circle cx="16" cy="16" r="8"/><circle cx="46" cy="24" r="5"/><circle cx="26" cy="46" r="6"/><circle cx="52" cy="52" r="3"/></g>`,
  brick: c => `<g fill="none" stroke="${c}" stroke-width="2"><path d="M0 16h64M0 40h64M20 0v16M44 16v24M20 40v24"/></g>`,
  wave: c => `<path d="M0 20q8-8 16 0t16 0 16 0 16 0M0 44q8-8 16 0t16 0 16 0 16 0" fill="none" stroke="${c}" stroke-width="2"/>`,
  dots: c => `<g fill="${c}"><circle cx="10" cy="10" r="3"/><circle cx="42" cy="26" r="3"/><circle cx="22" cy="50" r="3"/><circle cx="54" cy="56" r="2"/></g>`,
  grid: c => `<path d="M0 .5h64M.5 0v64" stroke="${c}" stroke-width="1" fill="none"/>`,
};
export const pattern = (kind: Kind, color: string) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64' opacity='.55'>${shapes[kind](color)}</svg>`)}")`;

const mk = (key: string, kind: Kind, a: string, b: string, tint: string, ink: string, Icon: LucideIcon): Look => ({ key, a, b, tint, ink, Icon, pat: pattern(kind, a) });

/** Looks matched by words in the category or industry name. The first match wins. */
const RULES: [RegExp, Look][] = [
  [/rice|wheat|flour|grain|maize|corn|pasta|bean|lentil|cereal/i, mk("grain", "grain", "#c8891a", "#f2c14e", "#fff6dc", "#4d3200", Wheat)],
  [/sugar|salt|sweet|honey|spice|candy/i, mk("sugar", "crystal", "#2d8fd5", "#8fd0f5", "#eaf6ff", "#08365f", Candy)],
  [/oil|ghee|butter|fat/i, mk("oil", "drop", "#d19a00", "#ffd43b", "#fff9d6", "#5c3f00", Droplets)],
  [/soap|detergent|clean|laundry|bleach|household|hygiene/i, mk("clean", "bubble", "#12a5a0", "#6fe0d6", "#e3fbf8", "#06504c", SprayCan)],
  [/construction|cement|steel|paint|tile|building|hardware|brick/i, mk("build", "brick", "#e0701b", "#ffb066", "#fff0e2", "#6b2b00", HardHat)],
  [/water|juice|milk|tea|coffee|drink|beverage|soda/i, mk("drink", "wave", "#7a4ad6", "#c6aaff", "#f1eaff", "#33177a", Milk)],
  [/spare|tool|machine|engine|auto/i, mk("tools", "grid", "#5b6b7a", "#a9b8c6", "#eef2f5", "#26323d", Wrench)],
];
const FALLBACK: [string, string, string, string, Kind][] = [
  ["#1a9d8a", "#6fd8c6", "#e3f8f4", "#07463d", "dots"], ["#d6457a", "#ff9ec0", "#ffeaf2", "#6b1233", "bubble"],
  ["#4a6fd8", "#a5b9ff", "#edf1ff", "#1b2f7a", "crystal"], ["#8a9a1f", "#d3e26a", "#f6f9de", "#3e4700", "grain"],
];

export function lookFor(category: string, industry?: string): Look {
  const text = `${category} ${industry ?? ""}`;
  const hit = RULES.find(([re]) => re.test(category)) ?? RULES.find(([re]) => re.test(text));
  if (hit) return hit[1];
  let h = 0;
  for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b, tint, ink, kind] = FALLBACK[h % FALLBACK.length];
  return { key: `x${h % FALLBACK.length}`, a, b, tint, ink, Icon: Package, pat: pattern(kind, a) };
}

/** Looks for when no category is picked: one for businesses, one for individuals. */
export const MODE_LOOK: Record<"business" | "individual", Look> = {
  business: mk("m-business", "grid", "#1479c2", "#3aa0e6", "#eaf3fb", "#0a3b64", Package),
  individual: mk("m-individual", "dots", "#e9a914", "#f6c453", "#fff7e0", "#5a4000", Package),
};

/** Shop design family. Food keeps the category-colour look; the others restyle the whole shop. */
export type ShopStyle = "food" | "fashion" | "build" | "fresh";
export function styleFor(industry?: string): ShopStyle {
  const t = industry ?? "";
  if (/cloth|fashion|apparel|wear|shoe|textile|garment|dress|abaya|fabric|accessor|jewel|bag/i.test(t)) return "fashion";
  if (/construct|build|hardware|cement|steel|paint|tool|spare|auto|machine|electric|plumb/i.test(t)) return "build";
  if (/household|clean|hygiene|soap|detergent|beauty|cosmetic|home|kitchen|baby/i.test(t)) return "fresh";
  return "food";
}
