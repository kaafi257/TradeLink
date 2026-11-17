import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { ArrowRight, ImagePlus, X } from "lucide-react";
import { IMAGE_ACCEPT, checkImage, removeProductImage, uploadProductImage } from "../lib/upload";
import { errorText, requireSupabase, type Product } from "../lib/supabase";
import { useAdmin } from "./AdminData";
import { FashionFields, useFashionEditor } from "./FashionFields";

export function ProductModal({ editing, onClose }: { editing: Product | null; onClose: () => void }) {
  const { notify, reload, industries, categories } = useAdmin();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fashion = useFashionEditor(editing?.id ?? null, notify);

  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const shown = preview ?? (removed ? null : editing?.image_url ?? null);

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const problem = checkImage(f);
    if (problem) { notify(problem); return; }
    setFile(f); setRemoved(false);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const text = (k: string) => String(f.get(k) ?? "").trim();
    const row: Record<string, unknown> = {
      name: text("name"),
      category_id: text("category_id") || null,
      sku: text("sku") || null, // empty SKU must be NULL: SKU is unique and "" would collide
      description: text("description") || null,
      package_size: text("package_size") || null,
      unit: text("unit"),
      wholesale_price: Number(f.get("wholesale_price") || 0),
      retail_price: Number(f.get("retail_price") || 0),
      audience: text("audience") || "both",
      min_order_quantity: Number(f.get("min_order_quantity") || 1),
      reorder_level: Number(f.get("reorder_level") || 0),
      active: f.get("active") === "on",
    };
    // Opening stock is allowed on creation only; afterwards stock changes go through Inventory → Adjust.
    if (!editing) row.stock_quantity = Number(f.get("stock_quantity") || 0);
    if (fashion.ready) {
      const sale = text("sale_price");
      row.brand = text("brand") || null;
      row.sale_price = sale ? Number(sale) : null;
      if (row.sale_price !== null && !(Number(row.sale_price) < Number(row.retail_price))) { notify("The sale price must be lower than the retail price."); return; }
    }
    setBusy(true);
    let uploaded: string | null = null;
    try {
      const s = requireSupabase();
      row.image_url = file ? (uploaded = await uploadProductImage(file)) : removed ? null : editing?.image_url ?? null;
      const result = editing
        ? await s.from("products").update(row).eq("id", editing.id).select("id").single()
        : await s.from("products").insert(row).select("id").single();
      if (result.error) throw result.error;
      if ((file || removed) && editing?.image_url) void removeProductImage(editing.image_url);
      try { await fashion.save(result.data.id as string); }
      catch (err) { notify(`Product saved, but its photos or options were not: ${errorText(err, "please try again")}`); onClose(); await reload(); return; }
      notify("Product saved successfully.");
      onClose();
      await reload();
    } catch (err) {
      if (uploaded) void removeProductImage(uploaded); // do not leave an unused image behind
      notify(errorText(err, "Could not save product"));
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
          <label>Category
            <select name="category_id" required defaultValue={editing?.category_id || ""}>
              <option value="" disabled>Choose a category…</option>
              {industries.map(i => (
                <optgroup key={i.id} label={i.active ? i.name : `${i.name} (hidden)`}>
                  {categories.filter(c => c.industry_id === i.id && (c.active || c.id === editing?.category_id)).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
            {!categories.length && <small>No categories yet. Add them under Industries &amp; Categories first.</small>}
          </label>
          <label>SKU<input name="sku" defaultValue={editing?.sku || ""} placeholder="e.g. RICE-50 (optional)" /></label>
          <label>Package size<input name="package_size" defaultValue={editing?.package_size || ""} placeholder="e.g. 50kg bag" /></label>
          <label>Unit<select name="unit" defaultValue={editing?.unit || "bag"}><option>bag</option><option>kg</option><option>ton</option><option>container</option><option>carton</option></select></label>
          <label>Wholesale price (ETB)<input name="wholesale_price" type="number" min="0" step="0.01" defaultValue={editing?.wholesale_price || 0} /></label>
          <label>Retail price (ETB, for individuals)<input name="retail_price" type="number" min="0" step="0.01" defaultValue={editing?.retail_price || 0} /><small>Shown publicly to individual buyers. 0 means "ask for a price".</small></label>
          <label>Sold to<select name="audience" defaultValue={editing?.audience || "both"}><option value="both">Businesses and individuals</option><option value="b2b">Businesses only (wholesale)</option><option value="b2c">Individuals only (retail)</option></select></label>
          <label>Minimum order quantity<input name="min_order_quantity" type="number" min="1" step="any" defaultValue={editing?.min_order_quantity || 1} /></label>
          <label>Reorder level (low-stock alert)<input name="reorder_level" type="number" min="0" step="any" defaultValue={editing?.reorder_level || 0} /></label>
          {editing
            ? <label>Available stock<input value={`${editing.stock_quantity} ${editing.unit}`} disabled readOnly /><small>Change it from Inventory → Adjust.</small></label>
            : <label>Opening stock<input name="stock_quantity" type="number" min="0" step="any" defaultValue={0} /></label>}
          <div className="full image-field">
            <span className="image-label">Product image</span>
            <div className="image-drop">
              {shown
                ? <img src={shown} alt="Product preview" />
                : <div className="image-empty"><ImagePlus /><b>No image yet</b><small>JPG, PNG or WebP. Large photos are resized automatically.</small></div>}
              <div className="image-actions">
                <button type="button" className="btn outline" onClick={() => fileRef.current?.click()}><ImagePlus /> {shown ? "Replace image" : "Choose image"}</button>
                {shown && <button type="button" className="btn outline" onClick={() => { setFile(null); setRemoved(true); }}>Remove</button>}
              </div>
              <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} onChange={pick} hidden />
            </div>
          </div>
          {fashion.ready && <>
            <label>Brand<input name="brand" maxLength={60} defaultValue={editing?.brand || ""} placeholder="Optional" /></label>
            <label>Sale price (ETB)<input name="sale_price" type="number" min="0" step="0.01" defaultValue={editing?.sale_price ?? ""} /><small>Optional. Must be lower than the retail price; shows the retail price struck through.</small></label>
          </>}
          <FashionFields ed={fashion} />
          <label className="full">Description<textarea name="description" rows={2} defaultValue={editing?.description || ""} /></label>
          <label className="checkbox-label full"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /> Product is active and visible on public website</label>
          <button className="btn green full" type="submit" disabled={busy}>{busy ? (file ? "Uploading image…" : "Saving…") : editing ? "Save Changes" : "Add Product"} <ArrowRight /></button>
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
      notify(errorText(err, "Could not adjust stock"));
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
