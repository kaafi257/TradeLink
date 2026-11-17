import { useCallback, useEffect, useState } from "react";

/** Same browser key the fashion storefront uses, so a heart saved in one place shows in the other. */
const KEY = "tradelink-wishlist";
const EVT = "tradelink-wishlist-change";
const read = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
};

export function useWishlist() {
  const [ids, setIds] = useState<string[]>(read);
  useEffect(() => {
    const sync = () => setIds(read());
    window.addEventListener("storage", sync);
    window.addEventListener(EVT, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(EVT, sync); };
  }, []);
  const toggle = useCallback((id: string) => {
    const cur = read();
    const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
    setIds(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); window.dispatchEvent(new Event(EVT)); } catch { /* storage unavailable: the heart still works for this visit */ }
  }, []);
  const has = useCallback((id: string) => ids.includes(id), [ids]);
  return { ids, has, toggle };
}
