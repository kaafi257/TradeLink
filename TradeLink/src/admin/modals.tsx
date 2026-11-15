import { useState, type FormEvent } from "react";
import { ArrowRight, X } from "lucide-react";
import { requireSupabase, type Product } from "../lib/supabase";
import { useAdmin } from "./AdminData";

export function ProductModal({ editing, onClose }: { editing: Product | null; onClose: () => void }) {
  const { notify, reload } = useAdmin();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const row: Record<string, unknown> = {
      name: text("name"),
      category: text("category"),
      sku: text("sku") || null, // empty SKU must be NULL: SKU is unique and "" would collide
      description: text("description") || null,
      image_url: text("image_url") || null,
      package_size: text("package_size") || null,
      unit: text("unit"),
      wholesale_price: Number(f.get("wholesale_price") || 0),
      min_order_quantity: Number(f.get("min_order_quantity") || 1),
      reorder_level: Number(f.get("reorder_level") || 0),
      active: f.get("active") === "on",
    };
    // Opening stock is allowed on creation only; afterwards stock changes go through Inventory → Adjust.
    if (!editing) row.stock_quantity = Number(f.get("stock_quantity") || 0);
    setBusy(true);
    try {
      const s = requireSupabase();
      const result = editing ? await s.from("products").update(row).eq("id", editing.id) : await s.from("products").insert(row);
      if (result.error) throw result.error;
      notify("Product saved successfully.");
      onClose();
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not save product");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal product-modal" role="dialog" aria-modal="true" aria-label="Product">
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">PRODUCT CATALOGUE</small>
        <h2>{editing ? "Edit Product" : "Add Wholesale Product"}</h2>
        <form className="form-grid" onSubmit={save}>
          <label>Product name<input name="name" required defaultValue={editing?.name} /></label>
          <label>Category<select name="category" defaultValue={editing?.category || "Rice"}><option>Rice</option><option>Sugar</option><option>Cooking Oil</option><option>Other Food Products</option></select></label>
          <label>SKU<input name="sku" defaultValue={editing?.sku || ""} placeholder="e.g. RICE-50 (optional)" /></label>
          <label>Package size<input name="package_size" defaultValue={editing?.package_size || ""} placeholder="e.g. 50kg bag" /></label>
          <label>Unit<select name="unit" defaultValue={editing?.unit || "bag"}><option>bag</option><option>kg</option><option>ton</option><option>container</option><option>carton</option></select></label>
          <label>Wholesale price (ETB)<input name="wholesale_price" type="number" min="0" step="0.01" defaultValue={editing?.wholesale_price || 0} /></label>
          <label>Minimum order quantity<input name="min_order_quantity" type="number" min="1" step="any" defaultValue={editing?.min_order_quantity || 1} /></label>
          <label>Reorder level (low-stock alert)<input name="reorder_level" type="number" min="0" step="any" defaultValue={editing?.reorder_level || 0} /></label>
          {editing
            ? <label>Available stock<input value={`${editing.stock_quantity} ${editing.unit}`} disabled readOnly /><small>Change it from Inventory → Adjust.</small></label>
            : <label>Opening stock<input name="stock_quantity" type="number" min="0" step="any" defaultValue={0} /></label>}
          <label className="full">Product image URL<input name="image_url" type="url" defaultValue={editing?.image_url || ""} placeholder="https://..." /></label>
          <label className="full">Description<textarea name="description" rows={2} defaultValue={editing?.description || ""} /></label>
          <label className="checkbox-label full"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /> Product is active and visible on public website</label>
          <button className="btn green full" type="submit" disabled={busy}>{editing ? "Save Changes" : "Add Product"} <ArrowRight /></button>
        </form>
      </div>
    </div>
  );
}

const MOVEMENTS = [
  { value: "purchase", label: "Stock received (purchase)" },
  { value: "return", label: "Customer return" },
  { value: "adjustment_in", label: "Correction: add stock" },
  { value: "adjustment_out", label: "Correction: remove stock" },
  { value: "damage", label: "Damaged / spoiled" },
];

export function StockModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const { notify, reload } = useAdmin();
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const { data, error } = await requireSupabase().rpc("adjust_stock", {
        p_product: product.id, p_type: String(f.get("type")), p_quantity: Number(f.get("quantity")), p_notes: String(f.get("notes") ?? ""),
      });
      if (error) throw error;
      notify(`Stock updated. ${product.name} is now ${data} ${product.unit}.`);
      onClose();
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not adjust stock");
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Adjust stock">
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">INVENTORY MOVEMENT</small>
        <h2>Adjust stock: {product.name}</h2>
        <p>Current stock: <b>{product.stock_quantity} {product.unit}</b>. Every change is recorded.</p>
        <form className="form-grid" onSubmit={save}>
          <label>Movement<select name="type" defaultValue="purchase">{MOVEMENTS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
          <label>Quantity ({product.unit})<input name="quantity" type="number" min="0.001" step="any" required /></label>
          <label className="full">Note (optional)<textarea name="notes" rows={2} placeholder="Supplier, invoice number, reason…" /></label>
          <button className="btn green full" type="submit" disabled={busy}>Record movement <ArrowRight /></button>
        </form>
      </div>
    </div>
  );
}
