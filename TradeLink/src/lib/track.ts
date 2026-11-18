import { supabase } from "./supabase";

/**
 * Anonymous website events for the Admin reports (visits, product views, searches).
 * A random id kept in this browser; no name, no IP, nothing personal. Failures are ignored on purpose.
 */
export const trackState = { off: false };

const KEY = "tradelink-sid";
let memory = "";
function sessionId(): string {
  try {
    let v = localStorage.getItem(KEY);
    if (!v) { v = crypto.randomUUID(); localStorage.setItem(KEY, v); }
    return v;
  } catch { return memory || (memory = crypto.randomUUID()); }
}

const seen = new Set<string>();
export function track(kind: "visit" | "product_view" | "category_view" | "industry_view" | "search", opts: { ref?: string; term?: string; results?: number; mode?: "business" | "individual" } = {}) {
  if (!supabase || trackState.off) return;
  const key = `${kind}:${opts.ref ?? ""}:${(opts.term ?? "").toLowerCase()}`;
  if (kind !== "search" && seen.has(key)) return; // one product or category view per page load is enough
  seen.add(key);
  void Promise.resolve(supabase.rpc("track_event", {
    p_session: sessionId(), p_kind: kind, p_ref: opts.ref ?? null, p_term: opts.term ?? null, p_results: opts.results ?? null, p_mode: opts.mode ?? null,
  })).catch(() => {});
}
