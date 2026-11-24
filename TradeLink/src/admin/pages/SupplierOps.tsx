import { useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Check, ClipboardList, Inbox, PackageCheck, Plus, Store, Trash2, Wallet, X } from "lucide-react";
import { useAdmin } from "../AdminData";
import { Tabs } from "../suite";
import "./payments.css";
import { errorText, requireSupabase } from "../../lib/supabase";
import { money } from "../../lib/format";
import { PO_LABEL, dateOf, qty, useLoad, type PO, type POItem, type SProduct } from "../../pages/supplier/ops";

type SupRow = { id: string; name: string };
type PRow = SProduct & { suppliers: { name: string } | null };
type PORow = PO & { suppliers: { name: string } | null };

type Listing = { supplier_product_id: string; listed: boolean; retail_price: number; sale_price: number | null; audience: string; stock_quantity: number };

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
    const [p, o, s, l] = await Promise.all([
      db.from("supplier_products").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(300),
      db.from("purchase_orders").select("*, suppliers(name)").order("created_at", { ascending: false }).limit(300),
      db.from("suppliers").select("id,name").eq("status", "approved").eq("active", true).order("name"),
      db.from("supplier_listing_status").select("*"),
    ]);
    for (const r of [p, o, s]) if (r.error) throw r.error;
    // Before migration 0015 the view does not exist; the approval list still works without the marketplace column.
    const listings = new Map(((l.error ? [] : l.data ?? []) as Listing[]).map(x => [x.supplier_product_id, x]));
    return { products: (p.data ?? []) as PRow[], orders: (o.data ?? []) as PORow[], suppliers: (s.data ?? []) as SupRow[], listings };
  });
  const run = async (fn: string, args: Record<string, unknown>, ask?: string) => {
    let note: string | null = null;
    if (ask) { note = window.prompt(ask); if (!note || note.trim().length < 3) { setMsg("A short reason is needed."); return; } }
    setMsg("");
    const { error } = await requireSupabase().rpc(fn, { ...args, p_note: note });
    if (error) setMsg(errorText(error, "Could not save")); else void reload();
  };
  const setPrice = async (p: PRow, cur: Listing | undefined) => {
    const v = window.prompt(`Your retail price for "${p.name}" (ETB per ${p.unit}). Use 0 to sell to businesses only.`, cur && cur.retail_price > 0 ? String(cur.retail_price) : "");
    if (v === null) return;
    const n = Number(v.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) { setMsg("Enter a price of 0 or more."); return; }
    setMsg("");
    const { error } = await requireSupabase().rpc("set_listing_price", { p_supplier_product: p.id, p_retail: n });
    if (error) setMsg(errorText(error, "Could not save the price")); else void reload();
  };
  const { search } = useAdmin();
  const q = search.toLowerCase();
  const [pf, setPf] = useState("all"), [of, setOf] = useState("all");
  const products = data?.products ?? [], orders = data?.orders ?? [];
  const pending = products.filter(p => p.status === "pending");
  const isOpen = (o: PORow) => !["delivered", "cancelled", "rejected"].includes(o.status);
  const openOrders = orders.filter(isOpen);
  const live = products.filter(p => data?.listings.get(p.id)?.listed).length;
  const openValue = openOrders.reduce((n, o) => n + Number(o.total_amount), 0);
  const pFilters = [{ id: "all", label: "All", n: products.length }, { id: "pending", label: "To approve", n: pending.length, hot: true }, { id: "approved", label: "Approved", n: products.filter(p => p.status === "approved").length }, { id: "rejected", label: "Rejected", n: products.filter(p => p.status === "rejected").length }];
  const oFilters = [{ id: "all", label: "All", n: orders.length }, { id: "open", label: "Open", n: openOrders.length, hot: true }, { id: "delivered", label: "Delivered", n: orders.filter(o => o.status === "delivered").length }, { id: "closed", label: "Cancelled", n: orders.filter(o => o.status === "cancelled" || o.status === "rejected").length }];
  const shownP = products.filter(p => (pf === "all" || p.status === pf) && `${p.name} ${p.brand ?? ""} ${p.sku ?? ""} ${p.suppliers?.name ?? ""}`.toLowerCase().includes(q));
  const shownO = orders.filter(o => (of === "all" || (of === "open" ? isOpen(o) : of === "closed" ? o.status === "cancelled" || o.status === "rejected" : o.status === of)) && `${o.po_number} ${o.store_name} ${o.suppliers?.name ?? ""}`.toLowerCase().includes(q));
  const tone = (st: string) => st === "approved" || st === "delivered" || st === "accepted" || st === "preparing" || st === "ready_for_pickup" ? "good" : st === "rejected" || st === "cancelled" ? "bad" : st === "dispatched" ? "info" : "warn";
  const initial = (n: string) => (n.trim()[0] ?? "?").toUpperCase();
  return (
    <div className="pm sop">
      <section className="pm-hero" aria-label="Supplier operations overview">
        <div className="pm-hero-top">
          <div><small>Supplier operations</small><h1>Products &amp; Purchase orders</h1><p>Approve what suppliers sell, and enter orders for their stores.</p></div>
          {tab === "orders" && <button className="pm-hero-btn" onClick={() => setShow(true)}><Plus size={16} /> New purchase order</button>}
        </div>
        <div className="pm-kpis">
          <div className="pm-kpi wait"><span><PackageCheck /></span><small>To approve</small><b>{pending.length}</b></div>
          <div className="pm-kpi in"><span><Store /></span><small>Live on marketplace</small><b>{live}</b></div>
          <div className="pm-kpi out"><span><ClipboardList /></span><small>Open orders</small><b>{openOrders.length}</b></div>
          <div className="pm-kpi owe"><span><Wallet /></span><small>Open order value</small><b>{money(openValue)}</b></div>
        </div>
      </section>
      <Tabs label="Supplier operations views" value={tab} onChange={setTab} tabs={[
        { id: "products", label: "Product approvals", icon: <PackageCheck />, count: pending.length },
        { id: "orders", label: "Purchase orders", icon: <ClipboardList />, count: openOrders.length },
      ]} />
      {msg && <p className="pm-note err" role="alert"><AlertTriangle size={16} />{msg}</p>}
      {loading ? <p className="muted">Loading…</p> : !data ? <p className="form-error" role="alert">{error}</p> : tab === "products" ? (
        <>
          <div className="pm-filters" role="tablist" aria-label="Filter products">
            {pFilters.map(f => <button key={f.id} role="tab" aria-selected={pf === f.id} className={`${pf === f.id ? "on" : ""}${f.hot ? " hot" : ""}`} onClick={() => setPf(f.id)}>{f.label}<i>{f.n}</i></button>)}
          </div>
          <div className="pm-list">
            {shownP.map(p => {
              const l = data.listings.get(p.id);
              const mk = !l ? "Not listed" : !l.listed ? "Hidden" : l.retail_price > 0 ? `Live · ${money(l.retail_price)}` : "Live · wholesale only";
              return (
                <div key={p.id} className="pm-card static so">
                  <span className="pm-av">{initial(p.name)}</span>
                  <span className="pm-main"><b>{p.name}<em>{p.suppliers?.name}</em></b><small>{[p.brand || p.sku, `${money(p.price)} / ${p.unit}`, mk].filter(Boolean).join(" · ")}</small></span>
                  <span className="pm-end"><span className={`pm-pill ${tone(p.status)}`}>{p.status[0].toUpperCase() + p.status.slice(1)}{!p.active && " · inactive"}</span></span>
                  <span className="pm-acts">
                    {p.status === "approved" && l && <button className="pm-go" onClick={() => void setPrice(p, l)}>Retail price</button>}
                    {p.status !== "approved" && <button className="pm-go hot" onClick={() => void run("review_supplier_product", { p_id: p.id, p_action: "approve" })}><Check size={15} /> Approve</button>}
                    {p.status === "pending" && <button className="pm-go bad" onClick={() => void run("review_supplier_product", { p_id: p.id, p_action: "reject" }, "Why is this product rejected? The supplier will see this.")}><X size={15} /> Reject</button>}
                  </span>
                </div>);
            })}
            {!shownP.length && <div className="pm-empty"><Inbox /><b>{products.length ? "Nothing matches" : "No supplier products yet"}</b></div>}
          </div>
        </>
      ) : (
        <>
          <div className="pm-filters" role="tablist" aria-label="Filter orders">
            {oFilters.map(f => <button key={f.id} role="tab" aria-selected={of === f.id} className={`${of === f.id ? "on" : ""}${f.hot ? " hot" : ""}`} onClick={() => setOf(f.id)}>{f.label}<i>{f.n}</i></button>)}
          </div>
          <div className="pm-list">
            {shownO.map(o => (
              <div key={o.id} className="pm-card static so">
                <span className="pm-ic blue"><ClipboardList /></span>
                <span className="pm-main"><b>{o.po_number}<em>{o.store_name}</em></b><small>{o.suppliers?.name} · {dateOf(o.created_at)}</small></span>
                <span className="pm-end"><b>{money(o.total_amount)}</b><span className={`pm-pill ${tone(o.status)}`}>{PO_LABEL[o.status]}</span></span>
                {(o.status === "dispatched" || isOpen(o)) && (
                  <span className="pm-acts">
                    {o.status === "dispatched" && <button className="pm-go hot" onClick={() => void run("admin_po_action", { p_po: o.id, p_action: "deliver" })}><Check size={15} /> Mark delivered</button>}
                    {isOpen(o) && <button className="pm-go bad" onClick={() => void run("admin_po_action", { p_po: o.id, p_action: "cancel" }, "Reason for cancelling this order?")}><X size={15} /> Cancel</button>}
                  </span>)}
              </div>))}
            {!shownO.length && <div className="pm-empty"><Inbox /><b>{orders.length ? "Nothing matches" : "No purchase orders yet"}</b></div>}
          </div>
        </>
      )}
      {show && data && <NewOrder suppliers={data.suppliers} onClose={() => setShow(false)} onDone={() => { setShow(false); void reload(); }} />}
    </div>
  );
}
export type { POItem };
