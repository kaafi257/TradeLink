import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChartNoAxesCombined, Package, Plus, ShoppingCart, UserPlus, Users, Wheat } from "lucide-react";
import { ActivityList, PanelHead } from "../../components/ui";
import { GlassStat, StockDonut } from "../DashWidgets";
import { RANGES, buildSeries, money, shortDate, type Range } from "../../lib/format";
import type { Product, Quote } from "../../lib/supabase";
import { ProductModal } from "../modals";
import { useAdmin } from "../AdminData";

const SalesChart = lazy(() => import("../SalesChart"));

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const LEVEL_LABEL: Record<Level, string> = { out: "Out of stock", low: "Running low", ok: "In stock" };
const RANK: Record<Level, number> = { out: 0, low: 1, ok: 2 };
const requestOf = (q: Quote) => q.quotation_items?.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(", ") || q.notes || "No details given";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
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

  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="dash-glass">
      <section className="dash-head">
        <div>
          <h1>{greeting()}, {firstName}</h1>
          <p>{today}{canSeeQuotes && newQuoteCount > 0 ? ` · ${newQuoteCount} new ${newQuoteCount === 1 ? "enquiry" : "enquiries"} to review` : ""}</p>
        </div>
        <div className="dash-actions">
          {can("products.edit") && <button className="btn green" onClick={() => setProductModal(true)}><Plus /> Add product</button>}
          {isLead && <button className="btn outline" onClick={() => navigate("/admin/staff")}><UserPlus /> Invite staff</button>}
          {canSeeQuotes && <button className="btn outline" onClick={() => navigate("/admin/quotations")}><ShoppingCart /> Quotations</button>}
        </div>
      </section>

      <section className="stats-grid" aria-label="Key figures">
        <GlassStat icon={<ShoppingCart />} tone="mint" value={canSeeQuotes ? String(quoteCount) : "—"} label="Orders & enquiries" note={canSeeQuotes ? `${newQuoteCount} new` : "No access"} onOpen={canSeeQuotes ? () => navigate("/admin/quotations") : undefined} />
        <GlassStat icon={<ChartNoAxesCombined />} tone="gold" value={canSeeSales && salesDaily.length ? money(monthSales) : "—"} label="Sales this month" note={salesDaily.length ? "vs same days last month" : "No sales recorded yet"} spark={canSeeSales ? monthSeries.slice(0, new Date().getDate()).map(p => p.sales) : undefined} delta={canSeeSales && salesDaily.length ? salesDelta : undefined} onOpen={canSeeSales ? () => navigate("/admin/sales") : undefined} />
        <GlassStat icon={<Package />} tone="blue" value={String(products.length)} label="Products" note={lowCount + outCount > 0 ? `${lowCount} low, ${outCount} out of stock` : "All in stock"} onOpen={() => navigate("/admin/products")} />
        <GlassStat icon={<Users />} tone="teal" value={isLead ? String(activeStaff) : "—"} label="Active staff" note={isLead ? `${staff.length - activeStaff} inactive` : "No access"} onOpen={isLead ? () => navigate("/admin/staff") : undefined} />
      </section>

      <section className="dash-grid">
        <div className="panel glass sales-panel">
          <PanelHead icon={<ChartNoAxesCombined />} title="Sales overview">
            <div className="range-tabs">{RANGES.map(r => <button className={range === r ? "on" : ""} key={r} onClick={() => setRange(r)}>{r}</button>)}</div>
          </PanelHead>
          {hasSales && <div className="chart-kpis"><div><small>{range} total</small><b>{money(rangeTotal)}</b></div>{best.sales > 0 && <div><small>Best {range === "This Year" ? "month" : "day"}</small><b>{best.day} · {money(best.sales)}</b></div>}</div>}
          <div className="chart-wrap">
            {hasSales
              ? <Suspense fallback={<p className="inline-note">Loading chart…</p>}><SalesChart data={series} /></Suspense>
              : <div className="empty-state"><ChartNoAxesCombined /><p>No sales recorded for this period. Recorded sales will appear here.</p></div>}
          </div>
          <div className="chart-foot"><span>Based on recorded sales only.</span>{isLead && <button onClick={() => navigate("/admin/reports")}>Open reports <ArrowRight size={14} /></button>}</div>
        </div>

        {showAttention && (
          <div className={`panel glass ${needsAttention ? "attention" : ""}`}>
            <PanelHead icon={<AlertTriangle />} title="Needs attention" />
            {canSeeQuotes && (
              <div className="attn-group">
                <p className="attn-label">New enquiries</p>
                {newQuotes.length === 0 && <p className="attn-clear">No new enquiries. Requests from the website appear here.</p>}
                {newQuotes.map(q => (
                  <button className="attn-item" key={q.id} onClick={() => navigate("/admin/quotations")}>
                    <div><b>{q.customer_name}</b><small>{requestOf(q)}</small></div>
                    <time>{shortDate(q.created_at)}</time>
                  </button>
                ))}
                {newQuoteCount > newQuotes.length && <button className="link-btn" style={{ margin: "4px 20px 10px" }} onClick={() => navigate("/admin/quotations")}>See all {newQuoteCount} new <ArrowRight size={14} /></button>}
              </div>
            )}
            <div className="attn-group">
              <p className="attn-label">Stock alerts</p>
              {stockAlerts.length === 0 && <p className="attn-clear">Every product is above its reorder level.</p>}
              {stockAlerts.map(p => (
                <div className="attn-item" key={p.id}>
                  <div><b>{p.name}</b><small>{LEVEL_LABEL[levelOf(p)]} · {p.stock_quantity} {p.unit} left</small></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="dash-grid even">
        <div className="panel glass">
          <PanelHead icon={<Wheat />} title="Stock levels"><button className="text-action" onClick={() => navigate("/admin/products")}>All products <ArrowRight size={14} /></button></PanelHead>
          {products.length > 0 && <StockDonut split={{ ok: okCount, low: lowCount, out: outCount }} />}
          {stockRows.length === 0 && <p className="attn-clear">No products yet. Add your first product to start tracking stock.</p>}
          {stockRows.map(p => {
            const lv = levelOf(p);
            return (
              <div className={`stock-row ${lv}`} key={p.id}>
                <div><b>{p.name}</b><small>{p.package_size || p.category}</small></div>
                <strong>{p.stock_quantity} {p.unit}<em>{LEVEL_LABEL[lv]}</em></strong>
                <div className="progress"><i style={{ width: `${barWidth(p)}%` }} /></div>
              </div>
            );
          })}
        </div>

        <div className="panel glass recent-panel">
          <PanelHead icon={<ChartNoAxesCombined />} title="Recent activity">
            {isLead && <button className="text-action" onClick={() => navigate("/admin/activity")}>Full log <ArrowRight size={14} /></button>}
          </PanelHead>
          <ActivityList items={activities} />
        </div>
      </section>

      {productModal && <ProductModal editing={null} onClose={() => setProductModal(false)} />}
    </div>
  );
}
