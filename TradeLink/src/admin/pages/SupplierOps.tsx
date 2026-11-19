import { useMemo, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { errorText, requireSupabase } from "../../lib/supabase";
import { PO_LABEL, dateOf, money, qty, useLoad, type PO, type POItem, type SProduct } from "../../pages/supplier/ops";

type SupRow = { id: string; name: string };
type PRow = SProduct & { suppliers: { name: string } | null };
type PORow = PO & { suppliers: { name: string } | null };

function NewOrder({ suppliers, onClose, onDone }: { suppliers: SupRow[]; onClose: () => void; onDone: () => void }) {
  const [sup, setSup] = useState(suppliers[0]?.id ?? "");
  const [store, setStore] = useState(""), [phone, setPhone] = useState(""), [addr, setAddr] = useState(""), [note, setNote] = useState("");
  const [lines, setLines] = useState<{ product: string; q: string }[]>([{ product: "", q: "" }]);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const { data: products } = useLoad(async () => {
    if (!sup) return [] as SProduct[];
    const { data, error } = await requireSupabase().from("supplier_products").select("*").eq("supplier_id", sup).eq("status", "approved").eq("active", true).order("name");
    if (error) throw error; return (data ?? []) as SProduct[];
  }, [sup]);
  const byId = useMemo(() => new Map((products ?? []).map(p => [p.id, p])), [products]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    const items = lines.filter(l => l.product).map(l => ({ product_id: l.product, quantity: Number(l.q) }));
    if (!items.length || items.some(i => !(i.quantity > 0))) return setErr("Add at least one product with a quantity.");
    setBusy(true);
    const { error } = await requireSupabase().rpc("admin_create_purchase_order", { p_supplier: sup, p_store_name: store, p_phone: phone || null, p_address: addr || null, p_note: note || null, p_items: items });
    setBusy(false);
    if (error) setErr(errorText(error, "Could not create the order")); else onDone();
  };
  return (
    <div className="modal-backdrop"><div className="modal wide-modal" role="dialog" aria-modal="true" aria-label="New purchase order">
      <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
      <h2>New purchase order</h2>
      <form className="form-grid" onSubmit={e => void submit(e)}>
        <label>Supplier<select value={sup} onChange={e => { setSup(e.target.value); setLines([{ product: "", q: "" }]); }}>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Store name<input value={store} onChange={e => setStore(e.target.value)} required minLength={2} maxLength={120} /></label>
        <label>Store phone<input value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} /></label>
        <label>Store address<input value={addr} onChange={e => setAddr(e.target.value)} maxLength={200} /></label>
        <label className="full">Note for the supplier<input value={note} onChange={e => setNote(e.target.value)} maxLength={500} /></label>
        <div className="full">
          {lines.map((l, i) => {
            const p = byId.get(l.product);
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 110px 36px", gap: 8, marginBottom: 8, alignItems: "end" }}>
                <label>Product<select value={l.product} onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, product: e.target.value } : x)))}><option value="">Choose a product</option>{(products ?? []).map(p2 => <option key={p2.id} value={p2.id}>{p2.name} · {money(p2.price)}/{p2.unit}</option>)}</select></label>
                <label>Qty{p && <small> min {qty(p.min_order_qty)}</small>}<input type="number" min="0" step="any" value={l.q} onChange={e => setLines(lines.map((x, j) => (j === i ? { ...x, q: e.target.value } : x)))} /></label>
                <button type="button" className="btn" aria-label="Remove line" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)}><Trash2 size={15} /></button>
              </div>);
          })}
          <button type="button" className="btn" onClick={() => setLines([...lines, { product: "", q: "" }])}><Plus size={15} /> Add product</button>
          <p className="muted" style={{ marginTop: 8 }}>Prices and bulk discounts are applied automatically from the supplier&apos;s approved price list.</p>
        </div>
        {err && <p className="form-error full" role="alert">{err}</p>}
        <button className="btn green full" disabled={busy || !sup}>{busy ? "Creating…" : "Create purchase order"}</button>
      </form>
    </div></div>
  );
}

export default function SupplierOps() {
  const [tab, setTab] = useState<"products" | "orders">("products");
  const [show, setShow] = useState(false), [msg, setMsg] = useState("");
  const { data, error, loading, reload } = useLoad(async () => {
    const db = requireSupabase();
    const [p, o, s] = await Promise.all([
      db.from("supplier_products").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(300),
      db.from("purchase_orders").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(300),
      db.from("suppliers").select("id,name").eq("status", "approved").eq("active", true).order("name"),
    ]);
    for (const r of [p, o, s]) if (r.error) throw r.error;
    return { products: (p.data ?? []) as PRow[], orders: (o.data ?? []) as PORow[], suppliers: (s.data ?? []) as SupRow[] };
  });
  const run = async (fn: string, args: Record<string, unknown>, ask?: string) => {
    let note: string | null = null;
    if (ask) { note = window.prompt(ask); if (!note || note.trim().length < 3) { setMsg("A short reason is needed."); return; } }
    setMsg("");
    const { error } = await requireSupabase().rpc(fn, { ...args, p_note: note });
    if (error) setMsg(errorText(error, "Could not save")); else void reload();
  };
  const pending = (data?.products ?? []).filter(p => p.status === "pending");
  return (
    <>
      <PageHeading title="Supplier Operations" sub="Approve supplier products and enter purchase orders." action={tab === "orders" ? <button className="btn green" onClick={() => setShow(true)}><Plus size={16} /> New purchase order</button> : undefined} />
      <div className="rp-tabs" role="tablist" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={tab === "products"} className={tab === "products" ? "on" : ""} onClick={() => setTab("products")}><span>Product approvals{pending.length > 0 && ` (${pending.length})`}</span></button>
        <button role="tab" aria-selected={tab === "orders"} className={tab === "orders" ? "on" : ""} onClick={() => setTab("orders")}><span>Purchase orders</span></button>
      </div>
      {msg && <p className="form-error" role="alert">{msg}</p>}
      {loading ? <p className="muted">Loading…</p> : !data ? <p className="form-error" role="alert">{error}</p> : tab === "products" ? (
        <div className="table-panel"><div className="table-scroll"><table className="rt rt-s">
          <thead><tr><th>Product</th><th>Supplier</th><th>Price</th><th>Status</th><th /></tr></thead>
          <tbody>{data.products.length === 0 ? <tr><td colSpan={5}>No supplier products yet.</td></tr> : data.products.map(p => (
            <tr key={p.id}><td><b>{p.name}</b><br /><small>{p.brand || p.sku || ""}</small></td><td>{p.suppliers?.name}</td><td>{money(p.price)} / {p.unit}</td><td>{p.status}{!p.active && " · inactive"}</td>
              <td className="row-actions">
                {p.status !== "approved" && <button className="btn green" onClick={() => void run("review_supplier_product", { p_id: p.id, p_action: "approve" })}>Approve</button>}
                {p.status === "pending" && <button className="btn danger" onClick={() => void run("review_supplier_product", { p_id: p.id, p_action: "reject" }, "Why is this product rejected? The supplier will see this.")}>Reject</button>}
              </td></tr>))}</tbody></table></div></div>
      ) : (
        <div className="table-panel"><div className="table-scroll"><table className="rt rt-s">
          <thead><tr><th>Order</th><th>Supplier</th><th>Store</th><th>Total</th><th>Status</th><th>Date</th><th /></tr></thead>
          <tbody>{data.orders.length === 0 ? <tr><td colSpan={7}>No purchase orders yet.</td></tr> : data.orders.map(o => (
            <tr key={o.id}><td><b>{o.po_number}</b></td><td>{o.suppliers?.name}</td><td>{o.store_name}</td><td>{money(o.total_amount)}</td><td>{PO_LABEL[o.status]}</td><td>{dateOf(o.created_at)}</td>
              <td className="row-actions">
                {o.status === "dispatched" && <button className="btn green" onClick={() => void run("admin_po_action", { p_po: o.id, p_action: "deliver" })}>Mark delivered</button>}
                {!["delivered", "cancelled", "rejected"].includes(o.status) && <button className="btn danger" onClick={() => void run("admin_po_action", { p_po: o.id, p_action: "cancel" }, "Reason for cancelling this order?")}>Cancel</button>}
              </td></tr>))}</tbody></table></div></div>
      )}
      {show && data && <NewOrder suppliers={data.suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); void reload(); }} />}
    </>
  );
}
export type { POItem };
