import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { supabase, type Activity, type Product, type Profile, type Quote, type SaleRow, type SalesPoint } from "../lib/supabase";

type AdminData = {
  profile: Profile;
  products: Product[];
  quotes: Quote[];
  quoteCount: number;
  newQuoteCount: number;
  activities: Activity[];
  staff: Profile[];
  /** Latest recorded sales (for the Sales page). */
  sales: SaleRow[];
  /** Per-day sales totals for the year, computed in the database (never truncated). */
  salesDaily: SalesPoint[];
  loading: boolean;
  reload: () => Promise<void>;
  search: string;
  setSearch: (v: string) => void;
  notice: string;
  notify: (msg: string) => void;
};
const Ctx = createContext<AdminData | null>(null);
export const useAdmin = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAdmin must be used inside AdminDataProvider");
  return v;
};

export function AdminDataProvider({ profile, children }: { profile: Profile; children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteCount, setQuoteCount] = useState(0);
  const [newQuoteCount, setNewQuoteCount] = useState(0);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [staff, setStaff] = useState<Profile[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [salesDaily, setSalesDaily] = useState<SalesPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const { pathname } = useLocation();

  useEffect(() => { setSearch(""); }, [pathname]);

  const notify = useCallback((msg: string) => {
    setNotice(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(""), 3500);
  }, []);

  const reload = useCallback(async () => {
    if (!supabase) return;
    const yearStart = new Date(new Date().getFullYear(), 0, 1).toISOString();
    // Row-level security decides what each role can read; a denied table simply comes back empty.
    const [prod, q, qAll, qNew, act, st, sl, daily] = await Promise.all([
      supabase.from("products").select("*").order("created_at", { ascending: false }),
      supabase.from("quotations").select("*, quotation_items(product_name, quantity, unit)").order("created_at", { ascending: false }).limit(200),
      supabase.from("quotations").select("id", { count: "exact", head: true }),
      supabase.from("quotations").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(8),
      supabase.from("profiles").select("*").order("full_name"),
      supabase.from("sales").select("id, receipt_number, customer_name, total_amount, amount_paid, payment_method, sold_at").order("sold_at", { ascending: false }).limit(200),
      supabase.rpc("sales_by_day", { p_from: yearStart }),
    ]);
    setProducts((prod.data ?? []) as Product[]);
    setQuotes((q.data ?? []) as Quote[]);
    setQuoteCount(qAll.count ?? 0);
    setNewQuoteCount(qNew.count ?? 0);
    setActivities((act.data ?? []) as Activity[]);
    setStaff((st.data ?? []) as Profile[]);
    setSales((sl.data ?? []) as SaleRow[]);
    setSalesDaily(((daily.data ?? []) as { day: string; total: number }[]).map(d => ({ sold_at: d.day, total_amount: Number(d.total) })));
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const value = useMemo<AdminData>(() => ({
    profile, products, quotes, quoteCount, newQuoteCount, activities, staff, sales, salesDaily, loading, reload, search, setSearch, notice, notify,
  }), [profile, products, quotes, quoteCount, newQuoteCount, activities, staff, sales, salesDaily, loading, reload, search, notice, notify]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
