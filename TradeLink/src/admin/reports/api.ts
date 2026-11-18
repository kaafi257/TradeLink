import { useEffect, useRef, useState } from "react";
import { requireSupabase } from "../../lib/supabase";

export type Preset = "today" | "week" | "month" | "year" | "custom";
export type Range = { from: Date; to: Date; bucket: "day" | "week" | "month"; label: string };
export const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

const sod = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Turns a preset (or custom dates, inclusive) into a [from, to) window and a sensible chart bucket. */
export function rangeFor(p: Preset, cf: string, ct: string): Range {
  const now = new Date(), today = sod(now);
  if (p === "today") return { from: today, to: addDays(today, 1), bucket: "day", label: "Today" };
  if (p === "week") return { from: addDays(today, -6), to: addDays(today, 1), bucket: "day", label: "Last 7 days" };
  if (p === "month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1), bucket: "day", label: "This month" };
  if (p === "year") return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1), bucket: "month", label: "This year" };
  const f = cf ? sod(new Date(cf + "T00:00")) : addDays(today, -29);
  let t = ct ? addDays(sod(new Date(ct + "T00:00")), 1) : addDays(today, 1);
  if (t <= f) t = addDays(f, 1);
  const days = Math.round((+t - +f) / 864e5);
  return { from: f, to: t, bucket: days <= 62 ? "day" : days <= 366 ? "week" : "month", label: `${ymd(f)} → ${ymd(addDays(t, -1))}` };
}

export const iso = (d: Date) => d.toISOString();
export const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

export async function rpc<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(name, args);
  if (error) throw new Error(error.message || "Report could not be loaded.");
  return data as T;
}

/** Loads a report function whenever its arguments change; ignores answers from outdated requests. */
export function useRpc<T>(name: string, args: Record<string, unknown>, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(enabled);
  const key = name + JSON.stringify(args);
  const seq = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    const n = ++seq.current;
    setLoading(true);
    rpc<T>(name, args).then(d => { if (n === seq.current) { setData(d); setError(""); } })
      .catch(e => { if (n === seq.current) setError(e instanceof Error ? e.message : "Report could not be loaded."); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
  return { data, error, loading };
}

export const num = (v: unknown) => (v == null || v === "" ? 0 : Number(v));
export const fmtN = (v: unknown) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(num(v));
export const fmtMoney = (v: unknown) => fmtN(v) + " ETB";
export const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "—");
export const fmtDateTime = (v: unknown) => (v ? new Date(String(v)).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
export const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : cur > 0 ? 100 : 0);
