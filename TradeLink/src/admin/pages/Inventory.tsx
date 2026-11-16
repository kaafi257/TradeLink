import { useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, PackageX } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import type { Product } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { StockModal } from "../modals";

type Level = "out" | "low" | "ok";
const levelOf = (p: Product): Level =>
  Number(p.stock_quantity) <= 0 ? "out" : Number(p.reorder_level) > 0 && Number(p.stock_quantity) <= Number(p.reorder_level) ? "low" : "ok";
const LABEL: Record<Level, string> = { out: "Out", low: "Low", ok: "OK" };

export default function Inventory() {
  const { products, search, can } = useAdmin();
  const [adjusting, setAdjusting] = useState<Product | null>(null);
  const s = search.toLowerCase();
  const rows = products.filter(p => `${p.name} ${p.sku || ""}`.toLowerCase().includes(s));

  return (
    <>
      <PageHeading title="Inventory Management" sub="Monitor available stock and record every stock movement." />
      <SummaryStrip items={[
        { icon: <CheckCircle2 />, tone: "mint", value: products.filter(p => levelOf(p) === "ok").length, label: "OK" },
        { icon: <AlertTriangle />, tone: "gold", value: products.filter(p => levelOf(p) === "low").length, label: "Low" },
        { icon: <PackageX />, tone: "red", value: products.filter(p => levelOf(p) === "out").length, label: "Out" },
        { icon: <Boxes />, tone: "blue", value: products.length, label: "All" },
      ]} />
      <DataTable headers={["Product", "SKU", "Package", "Available stock", "Reorder level", "Stock status", "Action"]} isEmpty={!rows.length} empty="No products yet">
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
      {adjusting && <StockModal product={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}
