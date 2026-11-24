import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldCheck, Smartphone,
  AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChartNoAxesCombined, ClipboardList, FileText, Inbox, MapPin, Package,
  PackageCheck, Plus, Receipt, ShoppingCart, Truck, UserPlus, Users, Wallet,
} from "lucide-react";
import { PanelHead } from "../../components/ui";
import { RANGES, buildSeries, money, type Range } from "../../lib/format";
import { requireSupabase, type OrderRow, type Product } from "../../lib/supabase";
import { ProductModal } from "../modals";
import { useAdmin } from "../AdminData";
import { Delta, HeroChart, Sparkline, StockDonut } from "../DashWidgets";
import { activityIcon, ago } from "../Records";
import "./dashboard.css";

const SalesChart = lazy(() => import("../SalesChart"));

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const RANK: Record<Level, number> = { out: 0, low: 1, ok: 2 };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** Order pipeline, in the order an order moves through it. */
const PIPE: { key: string; label: string; icon: ReactNode; tone: string }[] = [
  { key: "confirmed", label: "To sell", icon: <ClipboardList size={15} />, tone: "amber" },
  { key: "ready", label: "Ready", icon: <PackageCheck size={15} />, tone: "blue" },
  { key: "dispatched", label: "On the way", icon: <Truck size={15} />, tone: "violet" },
  { key: "completed", label: "Done", icon: <CheckCircle2 size={15} />, tone: "green" },
];
const ORDER_LABEL: Record<string, { label: string; tone: string }> = {
  confirmed: { label: "To sell", tone: "amber" }, ready: { label: "Ready", tone: "blue" }, dispatched: { label: "On the way", tone: "violet" },
  completed: { label: "Done", tone: "green" }, cancelled: { label: "Cancelled", tone: "red" },
};
const DELIVERY_LABEL: Record<string, { label: string; tone: string }> = {
  assigned: { label: "Assigned", tone: "blue" }, in_transit: { label: "On the way", tone: "violet" }, delivered: { label: "Delivered", tone: "green" }, failed: { label: "Failed", tone: "red" },
};

function Kpi({ tone, icon, label, value, sub, delta, spark, onOpen }: {
  tone: string; icon: ReactNode; label: string; value: string; sub?: ReactNode; delta?: number | null; spark?: number[]; onOpen?: () => void;
}) {
  const body = (
    <>
      <span className="dx-ico">{icon}</span>
      <div className="dx-kbody">
        <small>{label}</small>
        <b>{value}</b>
        {sub && <span className="dx-sub">{sub}</span>}
      </div>
      {delta !== undefined && delta !== null && <span className="dx-delta"><Delta pct={delta} /></span>}
      {spark && <span className="dx-spark"><Sparkline values={spark} /></span>}
    </>
  );
  return onOpen
    ? <button type="button" className={`dx-kpi ${tone}`} onClick={onOpen} aria-label={`${label}: ${value}`}>{body}</button>
    : <div className={`dx-kpi ${tone}`}>{body}</div>;
}

export default function Dashboard() {
  const { can, profile, products, quotes, quoteCount, newQuoteCount, activities, staff, salesDaily, orders, deliveries } = useAdmin();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("This Month");
  const [productModal, setProductModal] = useState(false);

  const role = profile.role;
  const isLead = ["owner", "manager"].includes(role);
  const canSeeQuotes = ["owner", "manager", "sales"].includes(role);
  const canSeeSales = canSeeQuotes;
  const canSeeDeliveries = canSeeQuotes || can("deliveries.update") || can("deliveries.assign");
  const firstName = (profile.full_name || profile.email).split(/[ @]/)[0];

  const series = useMemo(() => buildSeries(salesDaily, range), [salesDaily, range]);
  const hasSales = series.some(p => p.sales > 0);
  const monthSeries = useMemo(() => buildSeries(salesDaily, "This Month"), [salesDaily]);
  const monthSales = useMemo(() => monthSeries.reduce((n, p) => n + p.sales, 0), [monthSeries]);
  const sameDaysLast = useMemo(() => buildSeries(salesDaily, "Last Month").slice(0, new Date().getDate()).reduce((n, p) => n + p.sales, 0), [salesDaily]);
  const salesDelta = sameDaysLast > 0 ? ((monthSales - sameDaysLast) / sameDaysLast) * 100 : null;
  const rangeTotal = series.reduce((n, p) => n + p.sales, 0);
  const best = series.reduce((b, p) => (p.sales > b.sales ? p : b), { day: "", sales: 0 });
  const monthSpark = monthSeries.slice(0, new Date().getDate()).map(p => p.sales);

  // Stock is in different units (bags, kg, tons...), so products are counted, never added together.
  const outCount = products.filter(p => levelOf(p) === "out").length;
  const lowCount = products.filter(p => levelOf(p) === "low").length;
  const okCount = products.length - outCount - lowCount;
  const activeStaff = staff.filter(m => m.active).length;
  const stockRows = [...products].sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)] || Number(a.stock_quantity) - Number(b.stock_quantity)).slice(0, 5);
  const maxStock = Math.max(1, ...products.map(p => Number(p.stock_quantity)));
  const barWidth = (p: Product) => {
    const qty = Number(p.stock_quantity), reorder = Number(p.reorder_level);
    const pct = reorder > 0 ? (qty / (reorder * 3)) * 100 : (qty / maxStock) * 100;
    return Math.max(3, Math.min(100, pct));
  };

  // Bank, Telebirr and eBirr orders start as "waiting for payment", so they are counted here as well as in the bell.
  const canPay = can("payments.view") || role === "owner";
  const [payN, setPayN] = useState({ verify: 0, waiting: 0 });
  useEffect(() => {
    if (!canPay) return;
    const load = async () => {
      try {
        const db = requireSupabase();
        const [v, w] = await Promise.all([
          db.from("payments").select("id", { count: "exact", head: true }).eq("status", "submitted"),
          db.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending").neq("method", "cod"),
        ]);
        setPayN({ verify: v.count ?? 0, waiting: w.count ?? 0 });
      } catch { /* keep last numbers */ }
    };
    void load(); const t = window.setInterval(() => void load(), 30000); return () => window.clearInterval(t);
  }, [canPay]);

  // Orders: pipeline counts, money still to collect, best sellers, newest first.
  const liveOrders = orders.filter(o => o.status !== "cancelled");
  const pipe = PIPE.map(s => ({ ...s, n: orders.filter(o => o.status === s.key).length }));
  const pipeMax = Math.max(1, ...pipe.map(s => s.n));
  const owed = liveOrders.reduce((n, o) => n + Math.max(0, Number(o.total_amount) - Number(o.amount_paid)), 0);
  const openOrders = orders.filter(o => o.status === "confirmed" || o.status === "ready" || o.status === "dispatched").length;
  const recentOrders = orders.slice(0, 5);
  const top = useMemo(() => {
    const m = new Map<string, { name: string; unit: string; qty: number; value: number }>();
    for (const o of liveOrders) for (const it of o.order_items ?? []) {
      const cur = m.get(it.product_name) ?? { name: it.product_name, unit: it.unit, qty: 0, value: 0 };
      cur.qty += Number(it.quantity); cur.value += Number(it.quantity) * Number(it.unit_price);
      m.set(it.product_name, cur);
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders]);
  const topMax = Math.max(1, ...top.map(t => t.value));

  const activeDeliveries = deliveries.filter(d => d.status === "assigned" || d.status === "in_transit");
  const deliveryList = [...deliveries].sort((a, b) => Number(b.status === "in_transit") - Number(a.status === "in_transit") || +new Date(b.created_at) - +new Date(a.created_at)).slice(0, 4);

  const newQuotes = quotes.filter(q => q.status === "new").slice(0, 4);
  const stockAlerts = products.filter(p => levelOf(p) !== "ok").sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)]).slice(0, 3);
  const needsAttention = (canSeeQuotes && newQuoteCount > 0) || stockAlerts.length > 0;
  const showAttention = canSeeQuotes || role === "inventory";
  const alertCount = (canSeeQuotes ? newQuoteCount : 0) + lowCount + outCount;
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="dash-page dx">
      <section className="dx-hero">
        <div className="dx-hero-main">
          <span className="dx-date">{today}</span>
          <h1>{greeting()}, {firstName}</h1>
          <div className="dx-pills">
            {canSeeQuotes && <button onClick={() => navigate("/admin/quotations")} className={newQuoteCount ? "hot" : ""}><Inbox size={15} />{newQuoteCount} new quotes</button>}
            {canSeeQuotes && <button onClick={() => navigate("/admin/orders")}><ShoppingCart size={15} />{openOrders} open orders</button>}
            {canPay && <button onClick={() => navigate("/admin/payments")} className={payN.verify ? "hot" : ""}><ShieldCheck size={15} />{payN.verify} to verify</button>}
            {canPay && <button onClick={() => navigate("/admin/payments")} className={payN.waiting ? "hot" : ""}><Smartphone size={15} />{payN.waiting} waiting for payment</button>}
            {canSeeDeliveries && <button onClick={() => navigate("/admin/deliveries")}><Truck size={15} />{activeDeliveries.length} deliveries</button>}
            <button onClick={() => navigate("/admin/products")} className={lowCount + outCount ? "hot" : ""}><Boxes size={15} />{lowCount + outCount} low stock</button>
          </div>
          <div className="dx-actions">
            {can("products.edit") && <button className="dx-btn solid" onClick={() => setProductModal(true)}><Plus size={17} /> Add product</button>}
            {isLead && <button className="dx-btn ghost" aria-label="Invite staff" title="Invite staff" onClick={() => navigate("/admin/staff")}><UserPlus size={17} /> Staff</button>}
            {canSeeQuotes && <button className="dx-btn ghost" aria-label="Quotations" title="Quotations" onClick={() => navigate("/admin/quotations")}><FileText size={17} /> Quotes</button>}
          </div>
        </div>
        {canSeeSales && (
          <div className="dx-hero-card">
            <div className="dx-hero-top">
              <div><small>Sales this month</small><b>{salesDaily.length ? money(monthSales) : "—"}</b></div>
              {salesDelta !== null && <Delta pct={salesDelta} />}
            </div>
            {monthSales > 0
              ? <HeroChart data={monthSeries.slice(0, new Date().getDate())} />
              : <div className="dx-hero-empty"><ChartNoAxesCombined size={28} /></div>}
          </div>
        )}
      </section>

      <section className="dx-kpis" aria-label="Key figures">
        {canSeeSales && <Kpi tone="blue" icon={<ChartNoAxesCombined />} label="Sales" value={salesDaily.length ? money(monthSales) : "—"} delta={salesDelta} spark={monthSpark} onOpen={() => navigate("/admin/sales")} />}
        {canSeeQuotes && <Kpi tone="green" icon={<ShoppingCart />} label="Orders" value={String(orders.length)} sub={<><i className="d amber" />{openOrders} open</>} onOpen={() => navigate("/admin/orders")} />}
        {canSeeQuotes && <Kpi tone="amber" icon={<Wallet />} label="To collect" value={money(owed)} sub={<>unpaid on orders</>} onOpen={() => navigate("/admin/orders")} />}
        {canSeeQuotes && <Kpi tone="violet" icon={<Inbox />} label="Quotations" value={String(quoteCount)} sub={newQuoteCount ? <><i className="d red" />{newQuoteCount} new</> : <><i className="d green" />all handled</>} onOpen={() => navigate("/admin/quotations")} />}
        <Kpi tone="teal" icon={<Package />} label="Products" value={String(products.length)} sub={lowCount + outCount ? <><i className="d red" />{lowCount + outCount} need stock</> : <><i className="d green" />stock OK</>} onOpen={() => navigate("/admin/products")} />
        {isLead && <Kpi tone="rose" icon={<Users />} label="Staff" value={String(activeStaff)} sub={staff.length - activeStaff > 0 ? <>{staff.length - activeStaff} off</> : <>all active</>} onOpen={() => navigate("/admin/staff")} />}
      </section>

      <section className="dx-grid main">
        {canSeeSales && (
          <div className="dx-card sales">
            <PanelHead icon={<ChartNoAxesCombined />} title="Sales">
              <div className="range-tabs">{RANGES.map(r => <button className={range === r ? "on" : ""} key={r} onClick={() => setRange(r)}>{r}</button>)}</div>
            </PanelHead>
            {hasSales && (
              <div className="sc-stats">
                <div><small>Total sales</small><b>{money(rangeTotal)}</b></div>
                <div><small>Daily average</small><b>{money(Math.round(rangeTotal / Math.max(1, series.reduce((l, d, i) => (d.sales > 0 ? i + 1 : l), 0))))}</b></div>
                {best.sales > 0 && <div><small>Best day</small><b>{money(best.sales)}</b><em>{/^\d+$/.test(String(best.day)) ? `Day ${best.day}` : best.day}</em></div>}
                <div className="sc-legend" aria-hidden="true"><span><i className="bar" />Daily sales</span><span><i className="ln" />7-day average</span></div>
              </div>)}
            <div className="chart-wrap">
              {hasSales ? <Suspense fallback={null}><SalesChart data={series} /></Suspense> : <div className="empty-state"><ChartNoAxesCombined /></div>}
            </div>
            {isLead && <div className="chart-foot"><button onClick={() => navigate("/admin/reports")} aria-label="Open reports">Reports <ArrowRight size={14} /></button></div>}
          </div>
        )}

        {canSeeQuotes && (
          <div className="dx-card pipe">
            <PanelHead icon={<ShoppingCart />} title="Order pipeline"><button className="text-action" onClick={() => navigate("/admin/orders")} aria-label="All orders">All <ArrowRight size={14} /></button></PanelHead>
            <div className="dx-pipe">
              {pipe.map(s => (
                <button key={s.key} className={`dx-step ${s.tone}`} onClick={() => navigate("/admin/orders")}>
                  <span className="dx-step-ico">{s.icon}</span>
                  <span className="dx-step-name">{s.label}</span>
                  <b>{s.n}</b>
                  <span className="dx-track"><i style={{ width: `${s.n ? Math.max(6, (s.n / pipeMax) * 100) : 0}%` }} /></span>
                </button>
              ))}
            </div>
          </div>
        )}

        {showAttention && (
          <div className={`dx-card alerts ${needsAttention ? "hot" : ""}`}>
            <PanelHead icon={<AlertTriangle />} title="Needs attention">{alertCount > 0 && <span className="count-badge">{alertCount}</span>}</PanelHead>
            {!needsAttention && <div className="all-clear"><CheckCircle2 size={30} /></div>}
            {canSeeQuotes && newQuotes.map(q => (
              <button className="dx-item" key={q.id} onClick={() => navigate("/admin/quotations")}>
                <span className="dx-dot violet"><Inbox size={16} /></span>
                <b>{q.customer_name}</b>
                <time>{ago(q.created_at)}</time>
              </button>
            ))}
            {canSeeQuotes && newQuoteCount > newQuotes.length && <button className="link-btn more" onClick={() => navigate("/admin/quotations")}>+{newQuoteCount - newQuotes.length} <ArrowRight size={14} /></button>}
            {stockAlerts.map(p => (
              <div className="dx-item" key={p.id}>
                <span className={`dx-dot ${levelOf(p) === "out" ? "red" : "amber"}`}><Boxes size={16} /></span>
                <b>{p.name}</b>
                <strong className={levelOf(p)}>{p.stock_quantity} {p.unit}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      {canSeeQuotes && (
        <section className="dx-grid pair">
          <div className="dx-card">
            <PanelHead icon={<Receipt />} title="Recent orders"><button className="text-action" onClick={() => navigate("/admin/orders")} aria-label="All orders">All <ArrowRight size={14} /></button></PanelHead>
            {recentOrders.length === 0 && <div className="all-clear dim"><ShoppingCart size={28} /></div>}
            <div className="dx-orders">
              {recentOrders.map((o: OrderRow) => {
                const st = ORDER_LABEL[o.status] ?? { label: o.status, tone: "blue" };
                const total = Number(o.total_amount), paid = Number(o.amount_paid);
                const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;
                return (
                  <button key={o.id} className="dx-order" onClick={() => navigate("/admin/orders")}>
                    <span className="dx-av">{(o.customer_name || "?").slice(0, 1).toUpperCase()}</span>
                    <span className="dx-ow"><b>{o.customer_name}</b><small>{o.order_number} · {ago(o.created_at)}</small></span>
                    <span className="dx-om"><strong>{money(total)}</strong><span className="dx-bar"><i style={{ width: `${pct}%` }} /></span></span>
                    <span className={`dx-tag ${st.tone}`}>{st.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dx-card">
            <PanelHead icon={<ChartNoAxesCombined />} title="Top products"></PanelHead>
            {top.length === 0 && <div className="all-clear dim"><Package size={28} /></div>}
            <div className="dx-top">
              {top.map((t, i) => (
                <div className="dx-toprow" key={t.name}>
                  <span className="rank">{i + 1}</span>
                  <span className="nm"><b>{t.name}</b><small>{t.qty} {t.unit}</small></span>
                  <strong>{money(t.value)}</strong>
                  <span className="dx-track"><i style={{ width: `${(t.value / topMax) * 100}%` }} /></span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="dx-grid trio">
        <div className="dx-card">
          <PanelHead icon={<Boxes />} title="Stock"><button className="text-action" onClick={() => navigate("/admin/products")} aria-label="All products">All <ArrowRight size={14} /></button></PanelHead>
          {products.length > 0 && <StockDonut split={{ ok: okCount, low: lowCount, out: outCount }} />}
          {stockRows.map(p => {
            const lv = levelOf(p);
            return (
              <div className={`stock-row ${lv}`} key={p.id}>
                <b>{p.name}</b>
                <strong>{p.stock_quantity} {p.unit}</strong>
                <div className="progress"><i style={{ width: `${barWidth(p)}%` }} /></div>
              </div>
            );
          })}
        </div>

        {canSeeDeliveries && (
          <div className="dx-card">
            <PanelHead icon={<Truck />} title="Deliveries"><button className="text-action" onClick={() => navigate("/admin/deliveries")} aria-label="All deliveries">All <ArrowRight size={14} /></button></PanelHead>
            {deliveryList.length === 0 && <div className="all-clear dim"><Truck size={28} /></div>}
            {deliveryList.map(d => {
              const st = DELIVERY_LABEL[d.status] ?? { label: d.status, tone: "blue" };
              return (
                <button className="dx-item" key={d.id} onClick={() => navigate("/admin/deliveries")}>
                  <span className={`dx-dot ${st.tone}`}><Truck size={16} /></span>
                  <span className="dx-two"><b>{d.orders?.customer_name ?? "Delivery"}</b>{d.orders?.delivery_location && <small><MapPin size={12} />{d.orders.delivery_location}</small>}</span>
                  <span className={`dx-tag ${st.tone}`}>{st.label}</span>
                </button>
              );
            })}
          </div>
        )}

        <div className="dx-card">
          <PanelHead icon={<ChartNoAxesCombined />} title="Activity">
            {isLead && <button className="text-action" onClick={() => navigate("/admin/activity")} aria-label="Full activity log">All <ArrowRight size={14} /></button>}
          </PanelHead>
          <div className="act-list">
            {activities.slice(0, 6).map(a => (
              <div className="act-row" key={a.id}>
                <span className="act-ico">{activityIcon(a.description)}</span>
                <b>{a.description}</b>
                <time>{ago(a.created_at)}</time>
              </div>
            ))}
          </div>
        </div>
      </section>

      {productModal && <ProductModal editing={null} onClose={() => setProductModal(false)} />}
    </div>
  );
}
