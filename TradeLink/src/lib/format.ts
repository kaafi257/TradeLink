import type { SalesPoint } from "./supabase";

export const money = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n) + " ETB";
export const shortDate = (v: string) =>
  new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export type Range = "This Month" | "Last Month" | "This Year";
export const RANGES: Range[] = ["This Month", "Last Month", "This Year"];

/** Real sales totals grouped by day (month views) or by month (year view). */
export function buildSeries(sales: SalesPoint[], range: Range) {
  const now = new Date();
  if (range === "This Year") {
    const months = Array.from({ length: 12 }, (_, m) => ({
      day: new Date(now.getFullYear(), m, 1).toLocaleString([], { month: "short" }), sales: 0,
    }));
    for (const s of sales) {
      const d = new Date(s.sold_at);
      if (d.getFullYear() === now.getFullYear()) months[d.getMonth()].sales += Number(s.total_amount);
    }
    return months;
  }
  const base = new Date(now.getFullYear(), now.getMonth() - (range === "Last Month" ? 1 : 0), 1);
  const days = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const out = Array.from({ length: days }, (_, i) => ({ day: String(i + 1), sales: 0 }));
  for (const s of sales) {
    const d = new Date(s.sold_at);
    if (d.getFullYear() === base.getFullYear() && d.getMonth() === base.getMonth()) out[d.getDate() - 1].sales += Number(s.total_amount);
  }
  return out;
}
