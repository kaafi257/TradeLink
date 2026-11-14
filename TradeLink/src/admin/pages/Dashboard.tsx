import { lazy, Suspense, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Boxes, ChartNoAxesCombined, Clock3, Eye, FileText, Package, Plus, Settings, ShieldCheck, ShoppingCart, Users, Wheat } from "lucide-react";
import { ActivityList, PanelHead, Stat } from "../../components/ui";
import { oilImg, riceImg, sugarImg, warehouseImg } from "../../lib/assets";
import { RANGES, buildSeries, money, type Range } from "../../lib/format";
import { canEditProducts } from "../nav";
import { ProductModal } from "../modals";
import { useAdmin } from "../AdminData";

const SalesChart = lazy(() => import("../SalesChart"));

export default function Dashboard() {
  const { profile, products, quoteCount, newQuoteCount, activities, staff, sales } = useAdmin();
  const navigate = useNavigate();
  const [range, setRange] = useState<Range>("This Month");
  const [productModal, setProductModal] = useState(false);

  const series = useMemo(() => buildSeries(sales, range), [sales, range]);
  const hasSales = series.some(p => p.sales > 0);
  const monthSales = useMemo(() => buildSeries(sales, "This Month").reduce((n, p) => n + p.sales, 0), [sales]);
  const totalStock = products.reduce((n, p) => n + Number(p.stock_quantity || 0), 0);
  const stockLevels = [...products].sort((a, b) => b.stock_quantity - a.stock_quantity).slice(0, 4);
  const maxStock = Math.max(1, ...stockLevels.map(p => Number(p.stock_quantity)));
  const canSeeQuotes = ["owner", "manager", "sales"].includes(profile.role);
  const canSeeSales = ["owner", "manager", "sales"].includes(profile.role);
  const firstName = (profile.full_name || profile.email).split(/[ @]/)[0];

  return (
    <>
      <section className="welcome-banner" style={{ backgroundImage: `linear-gradient(90deg,rgba(255,255,255,.97),rgba(255,255,255,.72) 50%,rgba(255,255,255,.05)),url(${warehouseImg})` }}>
        <div className="welcome-mark"><Wheat /></div>
        <div><h1>Welcome back, {firstName}!</h1><p>Here’s what’s happening with your business today.</p></div>
        <div className="date-chip"><Clock3 size={17} /> {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</div>
      </section>

      <section className="stats-grid">
        <Stat icon={<ShoppingCart />} color="mint" value={canSeeQuotes ? String(quoteCount) : "—"} label="Total Orders & Enquiries" note={canSeeQuotes ? `${newQuoteCount} new` : "No access"} />
        <Stat icon={<ChartNoAxesCombined />} color="gold" value={canSeeSales && sales.length ? money(monthSales) : "—"} label="Sales This Month" note={sales.length ? "Recorded sales" : "No sales recorded yet"} />
        <Stat icon={<Package />} color="blue" value={totalStock.toLocaleString()} label="Current Stock Units" note={`${products.length} products`} />
        <Stat icon={<Users />} color="teal" value={String(staff.length)} label="Total Staff" note="Team" />
      </section>

      <section className="dashboard-grid">
        <div className="panel sales-panel">
          <PanelHead icon={<ChartNoAxesCombined />} title="Sales Overview">
            <div className="range-tabs">{RANGES.map(r => <button className={range === r ? "on" : ""} key={r} onClick={() => setRange(r)}>{r}</button>)}</div>
          </PanelHead>
          <div className="chart-wrap">
            {hasSales
              ? <Suspense fallback={<p className="inline-note">Loading chart…</p>}><SalesChart data={series} /></Suspense>
              : <div className="empty-state"><ChartNoAxesCombined /><p>No sales recorded for this period.</p></div>}
          </div>
          <div className="chart-foot"><span>Figures come from recorded sales only.</span>{["owner", "manager"].includes(profile.role) && <button onClick={() => navigate("/admin/reports")}>View reports <ArrowRight size={14} /></button>}</div>
        </div>

        <div className="panel top-products">
          <PanelHead icon={<Wheat />} title="Stock Levels"><button className="text-action" onClick={() => navigate("/admin/products")}>View All <ArrowRight size={14} /></button></PanelHead>
          {stockLevels.length === 0 && <p className="inline-note">No products yet.</p>}
          {stockLevels.map((p, i) => (
            <div className="top-product" key={p.id}>
              <img src={p.image_url || [riceImg, sugarImg, oilImg][i % 3]} alt="" />
              <div><b>{p.name}</b><small>{p.package_size || p.category}</small><div className="progress"><i style={{ width: `${Math.max(4, (Number(p.stock_quantity) / maxStock) * 100)}%` }} /></div></div>
              <strong>{p.stock_quantity} {p.unit}</strong>
            </div>
          ))}
        </div>

        <div className="panel recent-panel">
          <PanelHead icon={<span className="zap">ϟ</span>} title="Recent Activities">
            {["owner", "manager"].includes(profile.role) && <button className="text-action" onClick={() => navigate("/admin/activity")}>View All <ArrowRight size={14} /></button>}
          </PanelHead>
          <ActivityList items={activities} />
        </div>
      </section>

      <section className="bottom-grid">
        {canEditProducts(profile.role) && (
          <div className="management-card">
            <PanelHead icon={<Package />} title="Product Management" />
            <div className="management-body"><img src={riceImg} alt="Rice and food products" /><div>
              <button className="btn green" onClick={() => setProductModal(true)}><Plus /> Add Product</button>
              <button className="btn outline" onClick={() => navigate("/admin/products")}><Eye /> View Products</button>
              <button className="btn outline" onClick={() => navigate("/admin/inventory")}><Boxes /> Manage Stock</button>
            </div></div>
          </div>
        )}
        {["owner", "manager"].includes(profile.role) && (
          <div className="management-card">
            <PanelHead icon={<Users />} title="Staff Management" />
            <div className="management-body staff-management"><img src={warehouseImg} alt="Warehouse team" /><div>
              <button className="btn green" onClick={() => navigate("/admin/staff")}><Plus /> Invite Staff</button>
              <button className="btn outline" onClick={() => navigate("/admin/staff")}><Eye /> View Staff</button>
              <button className="btn outline" onClick={() => navigate("/admin/staff")}><ShieldCheck /> Manage Roles</button>
            </div></div>
          </div>
        )}
        <div className="quick-card">
          <h3><span>🚀</span> Quick Actions</h3>
          <div>
            {canSeeQuotes && <button onClick={() => navigate("/admin/quotations")}><FileText /><b>Quotations</b></button>}
            {["owner", "manager"].includes(profile.role) && <button onClick={() => navigate("/admin/reports")}><ChartNoAxesCombined /><b>View<br />Reports</b></button>}
            {["owner", "manager"].includes(profile.role) && <button onClick={() => navigate("/admin/settings")}><Settings /><b>Settings</b></button>}
          </div>
        </div>
      </section>
      {productModal && <ProductModal editing={null} onClose={() => setProductModal(false)} />}
    </>
  );
}
