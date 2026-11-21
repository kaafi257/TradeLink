import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Bell, Boxes, Check, CheckCircle2, ChartNoAxesCombined, Package, PackageX, SlidersHorizontal } from "lucide-react";
import type { Product } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { StockModal } from "../modals";
import "./inventory.css";

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const RANK: Record<Level, number> = { out: 0, low: 1, ok: 2 };
const LABEL: Record<Level, string> = { out: "Out of stock", low: "Running low", ok: "In stock" };
type Filter = "all" | Level;
type Sort = "need" | "name" | "most";

function Kpi({ tone, icon, label, value, on, onClick }: { tone: string; icon: ReactNode; label: string; value: number; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`iv-kpi ${tone}${on ? " on" : ""}`} onClick={onClick} aria-pressed={on}>
      <span className="iv-ico">{icon}</span>
      <span className="iv-kt"><small>{label}</small><b>{value}</b></span>
    </button>
  );
}

export default function Inventory() {
  const { products, search, can, profile } = useAdmin();
  const navigate = useNavigate();
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("need");
  const isLead = ["owner", "manager"].includes(profile.role);

  // Stock is in different units (bags, kg, tons...), so products are counted, never added together.
  const count = useMemo(() => {
    const c = { ok: 0, low: 0, out: 0 };
    for (const p of products) c[levelOf(p)]++;
    return c;
  }, [products]);
  const total = products.length;

  const s = search.toLowerCase();
  const rows = useMemo(() => {
    const list = products.filter(p => `${p.name} ${p.sku || ""} ${p.category || ""}`.toLowerCase().includes(s) && (filter === "all" || levelOf(p) === filter));
    return list.sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
      : sort === "most" ? Number(b.stock_quantity) - Number(a.stock_quantity)
      : RANK[levelOf(a)] - RANK[levelOf(b)] || Number(a.stock_quantity) - Number(b.stock_quantity));
  }, [products, s, filter, sort]);

  const seg = (n: number) => (total ? (n / total) * 100 : 0);

  return (
    <div className="iv">
      <section className="iv-hero">
        <div className="iv-hero-top">
          <div>
            <span className="iv-eyebrow"><Boxes size={15} /> Inventory</span>
            <h1>Stock overview</h1>
          </div>
          {isLead && <button className="iv-link" onClick={() => navigate("/admin/reports")} aria-label="Stock movement reports"><ChartNoAxesCombined size={16} /> Movements <ArrowRight size={14} /></button>}
        </div>
        <div className="iv-health" role="img" aria-label={`${count.ok} in stock, ${count.low} running low, ${count.out} out of stock`}>
          <i className="ok" style={{ width: `${seg(count.ok)}%` }} /><i className="low" style={{ width: `${seg(count.low)}%` }} /><i className="out" style={{ width: `${seg(count.out)}%` }} />
        </div>
        <div className="iv-legend"><span><i className="ok" />{count.ok} in stock</span><span><i className="low" />{count.low} low</span><span><i className="out" />{count.out} out</span></div>
      </section>

      <section className="iv-kpis" aria-label="Filter by stock level">
        <Kpi tone="blue" icon={<Boxes />} label="All products" value={total} on={filter === "all"} onClick={() => setFilter("all")} />
        <Kpi tone="green" icon={<CheckCircle2 />} label="In stock" value={count.ok} on={filter === "ok"} onClick={() => setFilter(f => (f === "ok" ? "all" : "ok"))} />
        <Kpi tone="orange" icon={<AlertTriangle />} label="Running low" value={count.low} on={filter === "low"} onClick={() => setFilter(f => (f === "low" ? "all" : "low"))} />
        <Kpi tone="red" icon={<PackageX />} label="Out of stock" value={count.out} on={filter === "out"} onClick={() => setFilter(f => (f === "out" ? "all" : "out"))} />
      </section>

      <div className="iv-bar">
        <span className="iv-count">{rows.length} {rows.length === 1 ? "product" : "products"}</span>
        <label className="iv-sort"><span className="sr-only">Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="need">Needs stock first</option><option value="name">Name A–Z</option><option value="most">Most in stock</option>
          </select>
        </label>
      </div>

      {rows.length === 0
        ? <div className="iv-empty"><Boxes size={34} /><b>{total ? "No matching products" : "No products yet"}</b></div>
        : (
          <div className="iv-grid">
            {rows.map((p, i) => {
              const lv = levelOf(p);
              const qty = Number(p.stock_quantity), reorder = Number(p.reorder_level);
              // The bar fills to 3x the reorder point; the tick marks the reorder point itself.
              const pct = reorder > 0 ? Math.min(100, (qty / (reorder * 3)) * 100) : qty > 0 ? 100 : 0;
              return (
                <article className={`iv-card ${lv}`} key={p.id} style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                  <div className="iv-top">
                    <span className="iv-thumb">{p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <Package size={22} />}</span>
                    <div className="iv-name"><b>{p.name}</b><small>{[p.sku, p.category].filter(Boolean).join(" · ") || "—"}</small></div>
                    <span className={`iv-pill ${lv}`}>{lv === "ok" ? <Check size={13} /> : <AlertTriangle size={13} />}{LABEL[lv]}</span>
                  </div>
                  <div className="iv-qty"><b>{p.stock_quantity}</b><span>{p.unit}</span></div>
                  <div className="iv-meter"><i style={{ width: `${Math.max(pct, qty > 0 ? 4 : 0)}%` }} />{reorder > 0 && <em style={{ left: "33.3%" }} />}</div>
                  <div className="iv-foot">
                    <span>{reorder > 0 && <><Bell size={13} /> Reorder at {reorder}</>}{p.package_size ? <>{reorder > 0 ? " · " : ""}{p.package_size}</> : null}</span>
                    {can("stock.adjust") && <button className="iv-adjust" onClick={() => setAdjusting(p)} aria-label={`Adjust stock for ${p.name}`}><SlidersHorizontal size={15} /> Adjust</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      {adjusting && <StockModal product={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}
