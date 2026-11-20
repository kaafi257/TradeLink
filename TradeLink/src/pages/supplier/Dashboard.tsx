import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Boxes, CheckCircle2, ClipboardList, Hourglass, Package, PackageCheck, Truck, Wallet } from "lucide-react";
import { requireSupabase } from "../../lib/supabase";
import { Pill, Spinner, dateOf, money, qty, useLoad } from "./ops";

type Dash = {
  products_total: number; products_active: number; products_pending: number; orders_new: number; orders_accepted: number; orders_awaiting_delivery: number;
  orders_completed: number; sales_total: number; sales_open: number; series: { day: string; value: number }[];
  low_stock: { id: string; name: string; available: number; level: number }[];
  recent: { id: string; po_number: string; store_name: string; status: string; total_amount: number; created_at: string }[];
};
/** 30 daily bars; hover or tap a bar to read the day and amount. */
function Bars({ data }: { data: { label: string; value: number }[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(1, ...data.map(d => d.value));
  const cur = hi != null ? data[hi] : null;
  return (
    <div className="sp-bars">
      <p className="sp-bars-read">{cur ? <><b>{money(cur.value)}</b> on {cur.label}</> : <span className="sp-muted">Tap a bar for the day&apos;s total</span>}</p>
      <div className="sp-bars-row" onMouseLeave={() => setHi(null)}>
        {data.map((d, i) => <button key={d.label} type="button" aria-label={`${d.label}: ${money(d.value)}`} className={i === hi ? "on" : ""} onMouseEnter={() => setHi(i)} onClick={() => setHi(i)} style={{ height: `${Math.max(d.value ? 6 : 2, (d.value / max) * 100)}%` }} />)}
      </div>
      <div className="sp-bars-axis"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></div>
    </div>
  );
}
const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();

export default function Dashboard() {
  const nav = useNavigate();
  const { data: d, error, loading } = useLoad(async () => {
    const { data, error } = await requireSupabase().rpc("supplier_dashboard", { p_tz: TZ });
    if (error) throw error; return data as Dash;
  });
  // Marketplace sales of this supplier's products, with TradeLink's commission taken off (rows are visible to this supplier only).
  const { data: earn } = useLoad(async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const { data, error } = await requireSupabase().from("sale_commissions").select("quantity, commission, supplier_earning").gte("created_at", since).limit(5000);
    if (error) return null;   // before the commissions update the card is simply not shown
    const rows = (data ?? []) as { quantity: number; commission: number; supplier_earning: number }[];
    return { earning: rows.reduce((a, r) => a + Number(r.supplier_earning), 0), commission: rows.reduce((a, r) => a + Number(r.commission), 0), units: rows.reduce((a, r) => a + Number(r.quantity), 0) };
  });
  const pts = useMemo(() => (d?.series ?? []).map(x => ({ label: new Date(x.day + "T00:00").toLocaleDateString([], { month: "short", day: "numeric" }), value: Number(x.value) })), [d]);
  if (loading) return <Spinner />;
  if (!d) return <p className="sp-note err" role="alert">{error}</p>;
  const cards = [
    { Icon: Package, label: "Products", value: d.products_total, note: `${d.products_active} active · ${d.products_pending} awaiting approval`, to: "/supplier/products" },
    { Icon: Hourglass, label: "New orders", value: d.orders_new, note: d.orders_new ? "Waiting for your answer" : "Nothing waiting", to: "/supplier/orders", hot: d.orders_new > 0 },
    { Icon: ClipboardList, label: "Accepted orders", value: d.orders_accepted, note: "Accepted or being prepared", to: "/supplier/orders" },
    { Icon: Truck, label: "Awaiting delivery", value: d.orders_awaiting_delivery, note: "Ready for pickup or dispatched", to: "/supplier/orders" },
    { Icon: PackageCheck, label: "Completed orders", value: d.orders_completed, note: "Delivered to stores", to: "/supplier/orders" },
    { Icon: Wallet, label: "Wholesale sales", value: money(d.sales_total), note: `${money(d.sales_open)} in open orders`, to: "/supplier/orders" },
    ...(earn ? [{ Icon: Wallet, label: "Marketplace earnings", value: money(earn.earning), note: `${money(earn.commission)} commission · ${Math.round(earn.units)} sold, 30 days`, to: "/supplier" }] : []),
  ];
  return (
    <div className="sp-dash">
      <div className="sp-stats">
        {cards.map(c => (
          <button key={c.label} className={`sp-stat${c.hot ? " hot" : ""}`} onClick={() => nav(c.to)}>
            <span className="ico"><c.Icon size={18} /></span><small>{c.label}</small><b>{c.value}</b><em>{c.note}</em>
          </button>
        ))}
      </div>
      <div className="sp-grid two">
        <section className="sp-card"><div className="sp-card-head"><h3>Wholesale sales <small>last 30 days, delivered orders</small></h3></div>
          {pts.some(p => p.value > 0) ? <Bars data={pts} /> : <p className="sp-empty small">No delivered orders in the last 30 days yet.</p>}
        </section>
        <section className="sp-card"><div className="sp-card-head"><h3>Low stock</h3><button className="sp-link" onClick={() => nav("/supplier/inventory")}>Inventory</button></div>
          {d.low_stock.length === 0 ? <p className="sp-empty small"><CheckCircle2 size={20} /> Stock levels are fine.</p> : (
            <ul className="sp-list">{d.low_stock.map(p => (
              <li key={p.id}><AlertTriangle size={16} className="warn" /><span><b>{p.name}</b><small>{qty(p.available)} left · alert at {qty(p.level)}</small></span></li>))}
            </ul>)}
          <p className="sp-muted">Payments and invoices will appear here once the finance update is added.</p>
        </section>
      </div>
      <section className="sp-card"><div className="sp-card-head"><h3>Recent orders</h3><button className="sp-link" onClick={() => nav("/supplier/orders")}>All orders</button></div>
        {d.recent.length === 0 ? <p className="sp-empty small"><Boxes size={20} /> No orders yet. New purchase orders from stores appear here.</p> : (
          <ul className="sp-rows">{d.recent.map(o => (
            <li key={o.id}><button onClick={() => nav("/supplier/orders")}><b>{o.po_number}</b><span>{o.store_name}</span><Pill s={o.status} /><em>{money(o.total_amount)}</em><small>{dateOf(o.created_at)}</small></button></li>))}
          </ul>)}
      </section>
    </div>
  );
}
