import { useState } from "react";
import { AlertTriangle, Bell, Boxes, Check, CheckCircle2, Package, PackageX, SlidersHorizontal } from "lucide-react";
import { PageHeading, SummaryStrip } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip, type Tone } from "../Records";
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
      <RecordList isEmpty={!rows.length} empty="No products yet" icon={<Boxes />}>
        {rows.map((p, i) => {
          const lv = levelOf(p);
          const qty = Number(p.stock_quantity), reorder = Number(p.reorder_level);
          const meter = reorder > 0 ? qty / (reorder * 3) : qty > 0 ? 1 : 0;
          const tone: Tone = lv === "ok" ? "good" : lv === "low" ? "warn" : "bad";
          return (
            <RecCard key={p.id} i={i} tone={tone} lead={<Boxes size={22} />} title={p.name} sub={p.sku || undefined}
              facts={[{ icon: <Package size={14} />, text: p.package_size ?? "" }, { icon: <Bell size={14} />, text: reorder > 0 ? `≤ ${p.reorder_level}` : "" }]}
              amount={`${p.stock_quantity} ${p.unit}`} meter={meter}
              status={<StatusChip tone={tone} icon={lv === "ok" ? <Check size={14} /> : <AlertTriangle size={14} />} pulse={lv !== "ok"}>{LABEL[lv]}</StatusChip>}
              actions={can("stock.adjust") ? <IconBtn primary tone="gold" icon={<SlidersHorizontal size={17} />} label="Adjust" onClick={() => setAdjusting(p)} /> : undefined} />
          );
        })}
      </RecordList>
      {adjusting && <StockModal product={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}
