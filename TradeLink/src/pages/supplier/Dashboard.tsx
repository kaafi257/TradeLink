import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, Boxes, CheckCircle2, Hourglass, Package, Truck, Wallet } from "lucide-react";
import { requireSupabase } from "../../lib/supabase";
import { useSupplier } from "./context";
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
  const { supplier } = useSupplier();
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
  const attn = [
    d.orders_new > 0 && { Icon: Hourglass, text: `${d.orders_new} new ${d.orders_new === 1 ? "order" : "orders"} waiting for you`, to: "/supplier/orders" },
    d.products_pending > 0 && { Icon: Package, text: `${d.products_pending} ${d.products_pending === 1 ? "product" : "products"} awaiting approval`, to: "/supplier/products" },
    d.low_stock.length > 0 && { Icon: AlertTriangle, text: `${d.low_stock.length} low on stock`, to: "/supplier/inventory" },
  ].filter(Boolean) as { Icon: typeof Package; text: string; to: string }[];
  const hour = new Date().getHours();
  const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const kpis = [
    ...(earn ? [{ Icon: Wallet, label: "Earnings · 30 days", value: money(earn.earning), note: `${Math.round(earn.units)} sold`, to: "/supplier/payments", tone: 1 }] : []),
    { Icon: Truck, label: "Wholesale sales", value: money(d.sales_total), note: `${money(d.sales_open)} in open orders`, to: "/supplier/orders", tone: 2 },
    { Icon: Hourglass, label: "New orders", value: String(d.orders_new), note: d.orders_new ? "Waiting for your answer" : "Nothing waiting", to: "/supplier/orders", hot: d.orders_new > 0, tone: 3 },
    { Icon: Package, label: "Products", value: String(d.products_total), note: `${d.products_active} active`, to: "/supplier/products", tone: 4 },
  ];
  const flow = [
    { label: "New", n: d.orders_new }, { label: "Preparing", n: d.orders_accepted }, { label: "On the way", n: d.orders_awaiting_delivery }, { label: "Delivered", n: d.orders_completed },
  ];
  const headline = earn ? { label: "Earned in the last 30 days", value: money(earn.earning), note: `${Math.round(earn.units)} sold · after TradeLink commission` } : { label: "Wholesale sales · 30 days", value: money(d.sales_total), note: `${money(d.sales_open)} in open orders` };
  return (
    <div className="sd">
      <header className="sd-hero">
        <div className="sd-hero-top">
          <span className="sd-logo" aria-hidden="true">{(supplier?.name ?? "S").trim()[0]?.toUpperCase()}</span>
          <div><small>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</small><h2>{hello}, {supplier?.name ?? "welcome"}</h2></div>
        </div>
        <div className="sd-hero-fig"><small>{headline.label}</small><b>{headline.value}</b><em>{headline.note}</em></div>
        <div className="sd-hero-acts">
          <button className="sd-hbtn solid" onClick={() => nav("/supplier/products")}><Package size={16} /> Add product</button>
          <button className="sd-hbtn" onClick={() => nav("/supplier/payments")}><Wallet size={16} /> Payments</button>
        </div>
      </header>
      {attn.length > 0 && <div className="sd-attn" role="status">{attn.map(a => <button key={a.text} onClick={() => nav(a.to)}><a.Icon size={16} />{a.text}</button>)}</div>}
      <div className="sd-kpis">
        {kpis.map(k => (
          <button key={k.label} className={`sd-kpi t${k.tone}${k.hot ? " hot" : ""}`} onClick={() => nav(k.to)}>
            <span><k.Icon size={18} /></span><small>{k.label}</small><b>{k.value}</b><em>{k.note}</em>
          </button>))}
      </div>
      <section className="sd-card">
        <div className="sd-card-head"><h3>Orders</h3><button className="sp-link" onClick={() => nav("/supplier/orders")}>All orders</button></div>
        <div className="sd-flow">{flow.map((f, i) => <div key={f.label} className={f.n ? "on" : ""}><b>{f.n}</b><small>{f.label}</small>{i < flow.length - 1 && <i aria-hidden="true" />}</div>)}</div>
        {d.recent.length === 0 ? <p className="sd-none"><i><Boxes size={22} /></i>No orders yet<small>New purchase orders from stores appear here.</small></p> : (
          <ul className="sd-list">{d.recent.map(o => (
            <li key={o.id}><button onClick={() => nav("/supplier/orders")}><span><b>{o.po_number}</b><small>{o.store_name} · {dateOf(o.created_at)}</small></span><Pill s={o.status} /><em>{money(o.total_amount)}</em></button></li>))}
          </ul>)}
      </section>
      <div className="sd-two">
        <section className="sd-card"><div className="sd-card-head"><h3>Wholesale sales <small>30 days</small></h3></div>
          {pts.some(p => p.value > 0) ? <Bars data={pts} /> : <p className="sd-none"><i><Truck size={22} /></i>No delivered orders yet<small>Delivered orders build this chart.</small></p>}
        </section>
        <section className="sd-card"><div className="sd-card-head"><h3>Low stock</h3><button className="sp-link" onClick={() => nav("/supplier/inventory")}>Inventory</button></div>
          {d.low_stock.length === 0 ? <p className="sd-none ok"><i><CheckCircle2 size={22} /></i>Stock levels are fine<small>Nothing is running low.</small></p> : (
            <ul className="sd-list">{d.low_stock.map(p => (
              <li key={p.id}><div><AlertTriangle size={16} className="warn" /><span><b>{p.name}</b><small>{qty(p.available)} left · alert at {qty(p.level)}</small></span></div></li>))}
            </ul>)}
        </section>
      </div>
    </div>
  );
}
