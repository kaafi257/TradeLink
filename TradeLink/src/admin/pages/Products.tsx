import { useState } from "react";
import { Edit3, Plus, Search } from "lucide-react";
import { PageHeading } from "../../components/ui";
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
      <div className="table-panel">
        <div className="table-toolbar"><b>{rows.length} Products</b><span><Search size={16} /><input aria-label="Search products" placeholder="Search products…" value={search} onChange={e => setSearch(e.target.value)} /></span></div>
        <div className="table-scroll"><table>
          <thead><tr><th>Product</th><th>Category</th><th>Package</th><th>Wholesale</th><th>Retail</th><th>Stock</th><th>Status</th>{canEdit && <th>Action</th>}</tr></thead>
          <tbody>{rows.map(p => (
            <tr key={p.id}>
              <td><div className="table-product"><img src={p.image_url || riceImg} alt="" /><b>{p.name}</b></div></td>
              <td>{p.category}</td><td>{p.package_size}</td>
              <td>{p.wholesale_price ? money(p.wholesale_price) : "Set price"}</td>
              <td>{Number(p.retail_price) > 0 ? money(Number(p.retail_price)) : "—"}</td>
              <td>{p.stock_quantity} {p.unit}</td>
              <td><span className={`status ${p.active ? "good" : "muted"}`}>{p.active ? "Active" : "Inactive"}</span></td>
              {canEdit && <td><button className="icon-action" aria-label={`Edit ${p.name}`} onClick={() => setModal({ editing: p })}><Edit3 size={16} /></button></td>}
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <div className="empty-state"><p>{products.length ? "No products match your search." : "No products yet. Add your first wholesale product."}</p></div>}
        </div>
      </div>
      {modal && <ProductModal editing={modal.editing} onClose={() => setModal(null)} />}
    </>
  );
}
