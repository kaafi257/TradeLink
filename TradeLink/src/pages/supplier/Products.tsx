import { useMemo, useState, type FormEvent } from "react";
import { Image as ImageIcon, Package, Pencil, Plus, Power, Search, Trash2, Upload } from "lucide-react";
import { errorText, requireSupabase, type PublicCategory } from "../../lib/supabase";
import { IMAGE_ACCEPT, productImageUrl, removeProductImage, uploadProductImage } from "./files";
import CategoryPicker, { sortCategories, type PickerOption } from "../../components/CategoryPicker";
import { useSupplier } from "./context";
import { Modal, Pill, Spinner, money, qty, useLoad, type SProduct } from "./ops";

type Tier = { min_qty: string; price: string };
type Form = { name: string; brand: string; sku: string; category_id: string; subcategory: string; unit: string; price: string; min_order_qty: string; reorder_level: string; description: string; tiers: Tier[]; images: string[]; active: boolean };
const blank: Form = { name: "", brand: "", sku: "", category_id: "", subcategory: "", unit: "bag", price: "", min_order_qty: "1", reorder_level: "0", description: "", tiers: [], images: [], active: true };
const fromRow = (p: SProduct): Form => ({ name: p.name, brand: p.brand ?? "", sku: p.sku ?? "", category_id: p.category_id ?? "", subcategory: p.subcategory ?? "", unit: p.unit, price: String(p.price), min_order_qty: String(p.min_order_qty), reorder_level: String(p.reorder_level), description: p.description ?? "", tiers: (p.bulk_tiers ?? []).map(t => ({ min_qty: String(t.min_qty), price: String(t.price) })), images: p.image_paths ?? [], active: p.active });

function ProductForm({ row, cats, supplierId, rates, ownRate, onClose, onDone }: { row: SProduct | null; cats: PickerOption[]; supplierId: string; rates: Map<string, number>; ownRate: number; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<Form>(row ? fromRow(row) : blank);
  const [busy, setBusy] = useState(false), [err, setErr] = useState(""), [up, setUp] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(p => ({ ...p, [k]: v }));
  const addImages = async (files: FileList | null) => {
    if (!files?.length) return;
    setUp(true); setErr("");
    try {
      const room = 8 - f.images.length; const paths: string[] = [];
      for (const file of Array.from(files).slice(0, room)) paths.push(await uploadProductImage(supplierId, file));
      setF(p => ({ ...p, images: [...p.images, ...paths] }));
    } catch (e) { setErr(errorText(e, "Could not upload the photo")); } finally { setUp(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const price = Number(f.price), moq = Number(f.min_order_qty), lvl = Number(f.reorder_level || 0);
    if (!(price >= 0) || f.price === "") return setErr("Enter the wholesale price in ETB.");
    if (!(moq > 0)) return setErr("The minimum order quantity must be above 0.");
    const tiers = f.tiers.filter(t => t.min_qty || t.price).map(t => ({ min_qty: Number(t.min_qty), price: Number(t.price) }));
    if (tiers.some(t => !(t.min_qty > 0) || !(t.price >= 0) || t.price >= price)) return setErr("Each bulk discount needs a quantity above 0 and a price below the base price.");
    setBusy(true);
    const body = {
      name: f.name.trim(), brand: f.brand.trim() || null, sku: f.sku.trim() || null, category_id: f.category_id || null, subcategory: f.subcategory.trim() || null,
      unit: f.unit.trim() || "piece", price, min_order_qty: moq, reorder_level: lvl, description: f.description.trim() || null, bulk_tiers: tiers, image_paths: f.images, active: f.active,
    };
    const db = requireSupabase();
    const { error } = row ? await db.from("supplier_products").update(body).eq("id", row.id) : await db.from("supplier_products").insert(body);
    setBusy(false);
    if (error) return setErr(/duplicate key|supplier_products_sku_idx/i.test(error.message) ? "You already have a product with that SKU." : errorText(error, "Could not save the product"));
    // Photos removed while editing are deleted from storage only after the product saved.
    if (row) await Promise.all(row.image_paths.filter(p => !f.images.includes(p)).map(removeProductImage));
    onDone();
  };
  return (
    <Modal title={row ? "Edit product" : "Add a product"} onClose={onClose} wide>
      <form className="sp-form pf" onSubmit={e => void submit(e)}>
        <section className="pf-sec">
          <h4><span>1</span>Product</h4>
          <label>Product name<input value={f.name} onChange={e => set("name", e.target.value)} required minLength={2} maxLength={120} placeholder="e.g. Sunflower oil 5L" /></label>
          <div className="cp-field"><span>Category</span><CategoryPicker options={cats} value={f.category_id} onChange={v => set("category_id", v)} required />
            {f.category_id && <small className="cp-rate">Commission for this category: <b>{rates.has(f.category_id) ? rates.get(f.category_id) : ownRate}%</b>{rates.has(f.category_id) ? "" : " (your standard rate)"}</small>}</div>
          <div className="sp-photos">
            {f.images.map(p => (
              <span key={p} className="ph"><img src={productImageUrl(p)} alt="" /><button type="button" aria-label="Remove photo" onClick={() => set("images", f.images.filter(x => x !== p))}><Trash2 size={13} /></button></span>))}
            {f.images.length < 8 && (
              <label className="ph add">{up ? "Uploading…" : <><Upload size={18} />Photo</>}<input type="file" accept={IMAGE_ACCEPT} multiple hidden disabled={up} onChange={e => { void addImages(e.target.files); e.target.value = ""; }} /></label>)}
          </div>
        </section>
        <section className="pf-sec">
          <h4><span>2</span>Price and quantity</h4>
          <div className="pf-row3">
            <label>Price (ETB)<input type="number" inputMode="decimal" min="0" step="0.01" value={f.price} onChange={e => set("price", e.target.value)} required /></label>
            <label>Unit<input value={f.unit} onChange={e => set("unit", e.target.value)} maxLength={20} placeholder="bag, carton, kg…" /></label>
            <label>Minimum order<input type="number" inputMode="decimal" min="0.001" step="any" value={f.min_order_qty} onChange={e => set("min_order_qty", e.target.value)} required /></label>
          </div>
        </section>
        <details className="pf-more">
          <summary>More details <small>optional</small></summary>
          <div className="sp-fgrid">
            <label>Brand<input value={f.brand} onChange={e => set("brand", e.target.value)} maxLength={60} /></label>
            <label>SKU<input value={f.sku} onChange={e => set("sku", e.target.value)} maxLength={40} /></label>
            <label>Subcategory<input value={f.subcategory} onChange={e => set("subcategory", e.target.value)} maxLength={60} /></label>
            <label>Low-stock alert at<input type="number" inputMode="decimal" min="0" step="any" value={f.reorder_level} onChange={e => set("reorder_level", e.target.value)} /><small>0 turns the alert off</small></label>
            <label className="span2">Description<textarea rows={3} value={f.description} onChange={e => set("description", e.target.value)} maxLength={1000} /></label>
          </div>
        </details>
        <details className="pf-more" open={f.tiers.length > 0}>
          <summary>Bulk discounts <small>{f.tiers.length ? `${f.tiers.length} set` : "optional"}</small></summary>
          {f.tiers.map((t, i) => (
            <div className="sp-tier" key={i}>
              <label>From quantity<input type="number" min="0" step="any" value={t.min_qty} onChange={e => set("tiers", f.tiers.map((x, j) => j === i ? { ...x, min_qty: e.target.value } : x))} /></label>
              <label>Price (ETB)<input type="number" min="0" step="0.01" value={t.price} onChange={e => set("tiers", f.tiers.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} /></label>
              <button type="button" className="sp-icon" aria-label="Remove discount" onClick={() => set("tiers", f.tiers.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>))}
          <button type="button" className="sp-btn line sm" onClick={() => set("tiers", [...f.tiers, { min_qty: "", price: "" }])}><Plus size={15} /> Add a discount</button>
        </details>
        <label className="sp-check"><input type="checkbox" checked={f.active} onChange={e => set("active", e.target.checked)} /> Available to order</label>
        {row && row.status !== "pending" && <p className="sp-note warn">Changing the name, description, brand, category or unit sends this product back to TradeLink for approval.</p>}
        {err && <p className="sp-note err" role="alert">{err}</p>}
        <div className="sp-actions"><button type="button" className="sp-btn line" onClick={onClose}>Cancel</button><button className="sp-btn primary" disabled={busy || up}>{busy ? "Saving…" : row ? "Save changes" : "Add product"}</button></div>
      </form>
    </Modal>
  );
}

export default function Products() {
  const { supplier } = useSupplier();
  const [q, setQ] = useState(""), [st, setSt] = useState(""), [cf, setCf] = useState("");
  const [edit, setEdit] = useState<SProduct | null | undefined>(undefined);
  const [msg, setMsg] = useState("");
  const { data, error, loading, reload } = useLoad(async () => {
    const db = requireSupabase();
    const [p, c, i, r] = await Promise.all([db.from("supplier_products").select("*").order("created_at", { ascending: false }), db.from("public_categories").select("*").order("name"), db.from("public_industries").select("id, name"), db.from("category_commission_public").select("category_id, rate")]);
    if (p.error) throw p.error;
    if (c.error) throw c.error;
    return { rows: (p.data ?? []) as SProduct[], cats: (c.data ?? []) as PublicCategory[], inds: new Map(((i.data ?? []) as { id: string; name: string }[]).map(x => [x.id, x.name])), rates: new Map(((r.data ?? []) as { category_id: string; rate: number }[]).map(x => [x.category_id, Number(x.rate)])) };
  });
  // Only the categories of the supplier's own industry (with "Other ..." last). A category already on an older product stays selectable so editing it never fails.
  // If the industry has no categories yet, every category is offered (grouped by industry) so the supplier is never stuck.
  const myCats = useMemo<PickerOption[]>(() => {
    const all = data?.cats ?? [];
    const own = all.filter(c => c.industry_id === supplier?.industry_id || (edit?.category_id === c.id));
    const list = own.some(c => c.industry_id === supplier?.industry_id) ? own : all;
    return sortCategories(list).map(c => ({ id: c.id, name: c.name, group: list === all ? data?.inds.get(c.industry_id) : undefined }));
  }, [data, supplier, edit]);
  const catName = useMemo(() => new Map((data?.cats ?? []).map(c => [c.id, c.name])), [data]);
  const usedCats = useMemo(() => { const ids = new Set((data?.rows ?? []).map(r => r.category_id)); return sortCategories((data?.cats ?? []).filter(c => ids.has(c.id))); }, [data]);
  const shown = (data?.rows ?? []).filter(p => (!cf || p.category_id === cf) && (!st || (st === "inactive" ? !p.active : p.status === st)) && (!q || `${p.name} ${p.sku ?? ""} ${p.brand ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const toggle = async (p: SProduct) => {
    setMsg("");
    const { error } = await requireSupabase().from("supplier_products").update({ active: !p.active }).eq("id", p.id);
    if (error) setMsg(errorText(error, "Could not change availability")); else void reload();
  };
  if (!supplier) return null;
  return (
    <>
      <div className="sp-toolbar">
        <label className="sp-search"><Search size={16} /><input placeholder="Search name, SKU or brand" value={q} onChange={e => setQ(e.target.value)} aria-label="Search products" /></label>
        <select value={st} onChange={e => setSt(e.target.value)} aria-label="Filter"><option value="">All products</option><option value="approved">Approved</option><option value="pending">Awaiting approval</option><option value="rejected">Needs changes</option><option value="inactive">Not available</option></select>
        <select value={cf} onChange={e => setCf(e.target.value)} aria-label="Filter by category"><option value="">All categories</option>{usedCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <button className="sp-btn primary" onClick={() => setEdit(null)}><Plus size={16} /> Add product</button>
      </div>
      {msg && <p className="sp-note err" role="alert">{msg}</p>}
      {loading ? <Spinner /> : error ? <p className="sp-note err" role="alert">{error}</p> : shown.length === 0 ? (
        <section className="sp-card"><p className="sp-empty"><Package size={24} />{data?.rows.length ? "No product matches." : "You have no products yet. Add your first product; TradeLink approves it before stores can order it."}</p></section>
      ) : (
        <ul className="sp-cards">{shown.map(p => (
          <li key={p.id} className={`sp-pcard${p.active ? "" : " off"}`}>
            <span className="thumb">{p.image_paths[0] ? <img src={productImageUrl(p.image_paths[0])} alt="" loading="lazy" /> : <ImageIcon size={22} />}</span>
            <div className="meta">
              <b>{p.name}</b>
              <small>{[p.brand, p.sku && `SKU ${p.sku}`, p.category_id && catName.get(p.category_id)].filter(Boolean).join(" · ") || "No details yet"}</small>
              <span className="price">{money(p.price)} <i>per {p.unit}</i> · min {qty(p.min_order_qty)}{p.bulk_tiers.length > 0 && ` · ${p.bulk_tiers.length} bulk discount${p.bulk_tiers.length > 1 ? "s" : ""}`}</span>
              <span className="tags"><Pill s={p.status} label={p.status === "pending" ? "Awaiting approval" : p.status === "rejected" ? "Needs changes" : "Approved"} />{!p.active && <span className="sp-pill hold">Not available</span>}</span>
              {p.status === "rejected" && p.review_note && <p className="sp-note err">TradeLink: {p.review_note}</p>}
            </div>
            <div className="acts">
              <button className="sp-icon" aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)}><Pencil size={17} /></button>
              <button className="sp-icon" aria-label={p.active ? `Make ${p.name} unavailable` : `Make ${p.name} available`} title={p.active ? "Deactivate" : "Activate"} onClick={() => void toggle(p)}><Power size={17} /></button>
            </div>
          </li>))}
        </ul>
      )}
      {edit !== undefined && <ProductForm row={edit} cats={myCats} supplierId={supplier.id} rates={data?.rates ?? new Map()} ownRate={Number(supplier.fee_rate ?? 0)} onClose={() => setEdit(undefined)} onDone={() => { setEdit(undefined); void reload(); }} />}
    </>
  );
}
