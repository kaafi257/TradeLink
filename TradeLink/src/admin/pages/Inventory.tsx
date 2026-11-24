import { useState } from "react";
import { Boxes } from "lucide-react";
import type { Product } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { StockModal } from "../modals";
import "./orders.css";

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const ST: Record<Level, { label: string; dot: string }> = { out: { label: "Out of stock", dot: "red" }, low: { label: "Low", dot: "amber" }, ok: { label: "In stock", dot: "green" } };
const TABS: [string, string][] = [["all", "All"], ["low", "Low"], ["out", "Out"], ["ok", "In stock"]];

export default function Inventory() {
  const { products, search, can } = useAdmin();
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const [tab, setTab] = useState("all");
  const s = search.toLowerCase();
  const count = (k: string) => (k === "all" ? products.length : products.filter(p => levelOf(p) === k).length);
  const rows = products.filter(p => (tab === "all" || levelOf(p) === tab) && `${p.name} ${p.sku || ""}`.toLowerCase().includes(s));

  return (
    <div className="ord inv">
      <header className="ord-h"><h1>Inventory</h1><p>Monitor available stock and record every stock movement.</p></header>
      <nav className="ord-tabs" aria-label="Stock level">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}<span>{count(k)}</span></button>)}
      </nav>
      {rows.length === 0 ? (
        <div className="ord-empty"><Boxes size={26} /><b>{products.length ? "No products match" : "No products yet"}</b></div>
      ) : (
        <div className="ord-table" role="table" aria-label="Inventory">
          <div className="ord-row head" role="row"><span>Product</span><span>Pack</span><span className="r">In stock</span><span className="r">Reorder at</span><span>Status</span><span /></div>
          {rows.map(p => {
            const st = ST[levelOf(p)];
            const reorder = Number(p.reorder_level);
            return (
              <div key={p.id} className="ord-item" role="row">
                <div className="ord-row">
                  <span className="ord-cu"><b>{p.name}</b><small>{p.sku || "No SKU"}</small></span>
                  <span className="ord-dt">{p.package_size || "—"}</span>
                  <span className="ord-am r"><b>{p.stock_quantity} {p.unit}</b></span>
                  <span className="ord-dt r">{reorder > 0 ? `${p.reorder_level} ${p.unit}` : "—"}</span>
                  <span className={`ord-st ${st.dot}`}><i />{st.label}</span>
                  <span className="ord-ac">{can("stock.adjust") && <button className="ord-b main" onClick={() => setAdjusting(p)}>Adjust stock</button>}</span>
                </div>
              </div>);
          })}
        </div>)}
      {adjusting && <StockModal product={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}
