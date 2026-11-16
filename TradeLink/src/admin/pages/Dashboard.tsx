import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChartNoAxesCombined, FileText, Inbox, Package, Plus, Receipt, ShoppingCart, Truck, UserPlus, Users } from "lucide-react";
import { PanelHead } from "../../components/ui";
import { RANGES, buildSeries, money, type Range } from "../../lib/format";
import type { Product } from "../../lib/supabase";
import { ProductModal } from "../modals";
import { useAdmin } from "../AdminData";
import { Chip, GlassStat, StockDonut } from "../DashWidgets";

const SalesChart = lazy(() => import("../SalesChart"));

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const RANK: Record<Level, number> = { out: 0, low: 1, ok: 2 };

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** "5m", "3h", "2d": short enough to scan. */
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

/** Picks an icon for an activity line from what it is about. */
const activityIcon = (text: string) => {
  const t = text.toLowerCase();
  if (/sale|receipt|payment/.test(t)) return <Receipt size={16} />;
  if (/quot/.test(t)) return <FileText size={16} />;
  if (/deliver|dispatch/.test(t)) return <Truck size={16} />;
  if (/stock|inventory/.test(t)) return <Boxes size={16} />;
  if (/staff|member|user/.test(t)) return <Users size={16} />;
  if (/order/.test(t)) return <ShoppingCart size={16} />;
  return <Package size={16} />;
};

export default function Dashboard() {
  const { can, profile, products, quotes, quoteCount, newQuoteCount, activities, staff, salesDaily } = useAdmin();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("This Month");
  const [productModal, setProductModal] = useState(false);

  const series = useMemo(() => buildSeries(salesDaily, range), [salesDaily, range]);
  const hasSales = series.some(p => p.sales > 0);
  const monthSeries = useMemo(() => buildSeries(salesDaily, "This Month"), [salesDaily]);
  const monthSales = useMemo(() => monthSeries.reduce((n, p) => n + p.sales, 0), [monthSeries]);
  // Compare like with like: sales so far this month against the same number of days last month.
  const sameDaysLast = useMemo(() => buildSeries(salesDaily, "Last Month").slice(0, new Date().getDate()).reduce((n, p) => n + p.sales, 0), [salesDaily]);
  const salesDelta = sameDaysLast > 0 ? ((monthSales - sameDaysLast) / sameDaysLast) * 100 : null;
  const rangeTotal = series.reduce((n, p) => n + p.sales, 0);
  const best = series.reduce((b, p) => (p.sales > b.sales ? p : b), { day: "", sales: 0 });

  const role = profile.role;
  const isLead = ["owner", "manager"].includes(role);
  const canSeeQuotes = ["owner", "manager", "sales"].includes(role);
  const canSeeSales = canSeeQuotes;
  const firstName = (profile.full_name || profile.email).split(/[ @]/)[0];

  // Stock is in different units (bags, kg, tons...), so products are counted, never added together.
  const outCount = products.filter(p => levelOf(p) === "out").length;
  const lowCount = products.filter(p => levelOf(p) === "low").length;
  const okCount = products.length - outCount - lowCount;
  const activeStaff = staff.filter(m => m.active).length;

  const stockRows = [...products]
    .sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)] || Number(a.stock_quantity) - Number(b.stock_quantity))
    .slice(0, 5);
  const maxStock = Math.max(1, ...products.map(p => Number(p.stock_quantity)));
  const barWidth = (p: Product) => {
    const qty = Number(p.stock_quantity), reorder = Number(p.reorder_level);
    const pct = reorder > 0 ? (qty / (reorder * 3)) * 100 : (qty / maxStock) * 100;
    return Math.max(3, Math.min(100, pct));
  };

  const newQuotes = quotes.filter(q => q.status === "new").slice(0, 4);
  const stockAlerts = products.filter(p => levelOf(p) !== "ok").sort((a, b) => RANK[levelOf(a)] - RANK[levelOf(b)]).slice(0, 3);
  const needsAttention = (canSeeQuotes && newQuoteCount > 0) || stockAlerts.length > 0;
  const showAttention = canSeeQuotes || ["inventory"].includes(role);
  const alertCount = (canSeeQuotes ? newQuoteCount : 0) + lowCount + outCount;

  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return (
    <div className="dash-glass">
      <section className="dash-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p>{today}</p>
        </div>
        <div className="dash-actions">
          {can("products.edit") && <button className="btn green" onClick={() => setProductModal(true)}><Plus /> Add product</button>}
          {isLead && <button className="btn outline icon-only" aria-label="Invite staff" title="Invite staff" onClick={() => navigate("/admin/staff")}><UserPlus /></button>}
          {canSeeQuotes && <button className="btn outline icon-only" aria-label="Quotations" title="Quotations" onClick={() => navigate("/admin/quotations")}><ShoppingCart /></button>}
        </div>
      </section>

      <section className="stats-grid" aria-label="Key figures">
        <GlassStat icon={<ShoppingCart />} tone="mint" value={canSeeQuotes ? String(quoteCount) : "—"} label="Orders"
          chips={canSeeQuotes && newQuoteCount > 0 ? <Chip tone="warn">{newQuoteCount} new</Chip> : undefined}
          onOpen={canSeeQuotes ? () => navigate("/admin/quotations") : undefined} />
        <GlassStat icon={<ChartNoAxesCombined />} tone="gold" value={canSeeSales && salesDaily.length ? money(monthSales) : "—"} label="Sales"
          spark={canSeeSales ? monthSeries.slice(0, new Date().getDate()).map(p => p.sales) : undefined}
          delta={canSeeSales && salesDaily.length ? salesDelta : undefined}
          onOpen={canSeeSales ? () => navigate("/admin/sales") : undefined} />
        <GlassStat icon={<Package />} tone="blue" value={String(products.length)} label="Products"
          chips={<>{lowCount > 0 && <Chip tone="warn">{lowCount}</Chip>}{outCount > 0 && <Chip tone="bad">{outCount}</Chip>}{lowCount + outCount === 0 && <Chip tone="good">OK</Chip>}</>}
          onOpen={() => navigate("/admin/products")} />
        <GlassStat icon={<Users />} tone="teal" value={isLead ? String(activeStaff) : "—"} label="Staff"
          chips={isLead && staff.length - activeStaff > 0 ? <Chip tone="muted">{staff.length - activeStaff} off</Chip> : undefined}
          onOpen={isLead ? () => navigate("/admin/staff") : undefined} />
      </section>

      <section className="dash-grid">
        <div className="panel glass sales-panel">
          <PanelHead icon={<ChartNoAxesCombined />} title="Sales">
            <div className="range-tabs">{RANGES.map(r => <button className={range === r ? "on" : ""} key={r} onClick={() => setRange(r)}>{r}</button>)}</div>
          </PanelHead>
          {hasSales && <div className="chart-kpis"><div><b>{money(rangeTotal)}</b></div>{best.sales > 0 && <div className="best"><small>Best</small><b>{best.day} · {money(best.sales)}</b></div>}</div>}
          <div className="chart-wrap">
            {hasSales
              ? <Suspense fallback={null}><SalesChart data={series} /></Suspense>
              : <div className="empty-state"><ChartNoAxesCombined /></div>}
          </div>
          {isLead && <div className="chart-foot"><button onClick={() => navigate("/admin/reports")} aria-label="Open reports">Reports <ArrowRight size={14} /></button></div>}
        </div>

        {showAttention && (
          <div className={`panel glass ${needsAttention ? "attention" : ""}`}>
            <PanelHead icon={<AlertTriangle />} title="Alerts">{alertCount > 0 && <span className="count-badge">{alertCount}</span>}</PanelHead>
            {!needsAttention && <div className="all-clear"><CheckCircle2 size={30} /></div>}
            {canSeeQuotes && newQuotes.map(q => (
              <button className="attn-item" key={q.id} onClick={() => navigate("/admin/quotations")}>
                <span className="avatar-dot"><Inbox size={16} /></span>
                <div><b>{q.customer_name}</b></div>
                <time>{ago(q.created_at)}</time>
              </button>
            ))}
            {canSeeQuotes && newQuoteCount > newQuotes.length && <button className="link-btn more" onClick={() => navigate("/admin/quotations")}>+{newQuoteCount - newQuotes.length} <ArrowRight size={14} /></button>}
            {stockAlerts.map(p => (
              <div className={`attn-item stock ${levelOf(p)}`} key={p.id}>
                <span className="avatar-dot"><Boxes size={16} /></span>
                <div><b>{p.name}</b></div>
                <strong>{p.stock_quantity} {p.unit}</strong>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="dash-grid even">
        <div className="panel glass">
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

        <div className="panel glass recent-panel">
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
