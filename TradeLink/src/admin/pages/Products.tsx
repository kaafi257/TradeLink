import { useState } from "react";
import { Banknote, Check, Edit3, EyeOff, Package, Plus, Search, Tag } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip } from "../Records";
import { riceImg } from "../../lib/assets";
import { money } from "../../lib/format";
import type { Product } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ProductModal } from "../modals";

export default function Products() {
  const { products, can, search, setSearch } = useAdmin();
  const [modal, setModal] = useState<{ editing: Product | null } | null>(null);
  const canEdit = can("products.edit");
  const q = search.toLowerCase();
  const rows = products.filter(p => `${p.name} ${p.category} ${p.sku || ""}`.toLowerCase().includes(q));

  return (
    <>
      <PageHeading title="Product Management" sub="Add, update and manage your wholesale food catalogue."
        action={canEdit ? <button className="btn gold" onClick={() => setModal({ editing: null })}><Plus /> Add Product</button> : undefined} />
      <div className="table-panel list-toolbar">
        <div className="table-toolbar"><b>{rows.length} Products</b><span><Search size={16} /><input aria-label="Search products" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} /></span></div>
      </div>
      <RecordList isEmpty={!rows.length} empty={products.length ? "No match" : "No products yet"} icon={<Package />}>
        {rows.map((p, i) => (
          <RecCard key={p.id} i={i} tone={p.active ? "good" : "muted"} img={p.image_url || riceImg} title={p.name} sub={p.category}
            facts={[{ icon: <Package size={14} />, text: p.package_size ?? "" }, { icon: <Tag size={14} />, text: p.wholesale_price ? money(p.wholesale_price) : "Set price" }, ...(Number(p.retail_price) > 0 ? [{ icon: <Banknote size={14} />, text: money(Number(p.retail_price)) }] : [])]}
            amount={`${p.stock_quantity} ${p.unit}`}
            status={<StatusChip tone={p.active ? "good" : "muted"} icon={p.active ? <Check size={14} /> : <EyeOff size={14} />}>{p.active ? "Active" : "Off"}</StatusChip>}
            actions={canEdit ? <IconBtn icon={<Edit3 size={17} />} label={`Edit ${p.name}`} onClick={() => setModal({ editing: p })} /> : undefined} />
        ))}
      </RecordList>
      {modal && <ProductModal editing={modal.editing} onClose={() => setModal(null)} />}
    </>
  );
}
