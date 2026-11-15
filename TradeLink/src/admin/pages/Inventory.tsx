import { useState } from "react";
import { DataTable, PageHeading } from "../../components/ui";
import type { Product } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { StockModal } from "../modals";

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const LABEL: Record<Level, string> = { out: "Out of stock", low: "Low stock", ok: "In stock" };

export default function Inventory() {
  const { products, search, can } = useAdmin();
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const s = search.toLowerCase();
  const rows = products.filter(p => `${p.name} ${p.sku || ""}`.toLowerCase().includes(s));

  return (
    <>
      <PageHeading title="Inventory Management" sub="Monitor available stock and record every stock movement." />
      <div className="summary-strip">
        <div><b>{products.filter(p => levelOf(p) === "ok").length}</b><small>In stock</small></div>
        <div><b>{products.filter(p => levelOf(p) === "low").length}</b><small>Low stock items</small></div>
        <div><b>{products.filter(p => levelOf(p) === "out").length}</b><small>Out of stock</small></div>
        <div><b>{products.length}</b><small>Tracked products</small></div>
      </div>
      <DataTable headers={["Product", "SKU", "Package", "Available stock", "Reorder level", "Stock status", "Action"]} isEmpty={!rows.length} empty="Add products to begin tracking inventory.">
        {rows.map(p => {
          const lv = levelOf(p);
          return (
            <tr key={p.id}>
              <td><b>{p.name}</b></td><td>{p.sku || "—"}</td><td>{p.package_size}</td>
              <td>{p.stock_quantity} {p.unit}</td><td>{Number(p.reorder_level) > 0 ? p.reorder_level : "Not set"}</td>
              <td><span className={`status ${lv === "ok" ? "good" : "warn"}`}>{LABEL[lv]}</span></td>
              <td>{can("stock.adjust") ? <button className="btn outline" onClick={() => setAdjusting(p)}>Adjust</button> : "—"}</td>
            </tr>
          );
        })}
      </DataTable>
      <p className="inline-note">Stock changes are recorded as inventory movements, so there is always a trail of who changed what.</p>
      {adjusting && <StockModal product={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}
