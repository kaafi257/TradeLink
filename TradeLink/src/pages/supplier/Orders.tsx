import { useMemo, useState } from "react";
import { Download, PackageOpen } from "lucide-react";
import { exportPDF } from "../../admin/reports/exporters";
import { errorText, requireSupabase } from "../../lib/supabase";
import { Modal, PO_LABEL, Pill, Spinner, dateOf, dateTime, money, qty, useLoad, type PO, type POItem, type POStatus, type StockRow, type Warehouse } from "./ops";

const FILTERS: [string, string[]][] = [["All", []], ["New", ["new"]], ["In progress", ["accepted", "preparing", "ready_for_pickup"]], ["Dispatched", ["dispatched"]], ["Done", ["delivered", "rejected", "cancelled"]]];
const lineQty = (i: POItem) => Number(i.qty_confirmed ?? i.qty_ordered);

function Detail({ po, onClose, onDone }: { po: PO; onClose: () => void; onDone: () => void }) {
  const { data, error, loading } = useLoad(async () => {
    const db = requireSupabase();
    const [i, c, w, s] = await Promise.all([
      db.from("purchase_order_items").select("*").eq("po_id", po.id).order("product_name"),
      db.from("purchase_order_contacts").select("*").eq("po_id", po.id).maybeSingle(),
      db.from("supplier_warehouses").select("*").eq("active", true).order("name"),
      db.from("supplier_stock").select("*"),
    ]);
    for (const r of [i, c, w, s]) if (r.error) throw r.error;
    return { items: (i.data ?? []) as POItem[], contact: c.data as { store_phone: string | null; store_address: string | null } | null, warehouses: (w.data ?? []) as Warehouse[], stock: (s.data ?? []) as StockRow[] };
  }, [po.id]);
  const [plan, setPlan] = useState<Record<string, { q: string; w: string }>>({});
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const freeIn = (pid: string, wid: string) => Number(data?.stock.find(s => s.product_id === pid && s.warehouse_id === wid)?.available ?? 0);
  const bestWh = (i: POItem) => [...(data?.warehouses ?? [])].sort((a, b) => freeIn(i.product_id, b.id) - freeIn(i.product_id, a.id))[0]?.id ?? "";
  const row = (i: POItem) => plan[i.id] ?? { q: String(i.qty_ordered), w: bestWh(i) };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(true); setErr("");
    const { error } = await requireSupabase().rpc("supplier_po_action", { p_po: po.id, p_action: action, p_note: note.trim() || null, p_items: null, ...extra });
    setBusy(false);
    if (error) setErr(errorText(error, "Could not update the order")); else onDone();
  };
  const accept = () => act("accept", { p_items: (data?.items ?? []).map(i => ({ item_id: i.id, quantity: Number(row(i).q), warehouse_id: row(i).w || null })) });
  const download = () => void exportPDF(`Order ${po.po_number}`, `${po.store_name} · ${dateOf(po.created_at)} · ${PO_LABEL[po.status]}`,
    [{ key: "product_name", label: "Product" }, { key: "unit", label: "Unit" }, { key: "o", label: "Ordered" }, { key: "c", label: "Confirmed" }, { key: "p", label: "Price (ETB)" }, { key: "t", label: "Total (ETB)" }],
    (data?.items ?? []).map(i => ({ ...i, o: qty(i.qty_ordered), c: i.qty_confirmed == null ? "—" : qty(i.qty_confirmed), p: Number(i.unit_price), t: lineQty(i) * Number(i.unit_price) })));

  const s: POStatus = po.status;
  const need = (label: string) => note.trim().length < 3 && setErr(`${label} needs a short reason.`);
  return (
    <Modal title={`${po.po_number} · ${po.store_name}`} onClose={onClose} wide>
      {loading ? <Spinner /> : !data ? <p className="sp-note err" role="alert">{error}</p> : (
        <div className="sp-form">
          <div className="sp-od-head"><Pill s={s} /><span>{dateTime(po.created_at)}</span><b>{money(po.total_amount)}</b></div>
          {po.store_note && <p className="sp-note"><b>Store note:</b> {po.store_note}</p>}
          <div className="sp-od-contact">{data.contact ? <><b>Store contact</b><span>{data.contact.store_phone || "No phone given"}</span><span>{data.contact.store_address || "No address given"}</span></> : <span className="sp-muted">The store&apos;s phone and address are shown after you accept the order.</span>}</div>
          <ul className="sp-items">{data.items.map(i => (
            <li key={i.id}>
              <div><b>{i.product_name}</b><small>{money(i.unit_price)} per {i.unit} · ordered {qty(i.qty_ordered)}{i.qty_confirmed != null && ` · confirmed ${qty(i.qty_confirmed)}`}</small></div>
              {s === "new" ? (
                <div className="plan">
                  <label>Confirm<input type="number" min="0" max={i.qty_ordered} step="any" value={row(i).q} onChange={e => setPlan(p => ({ ...p, [i.id]: { ...row(i), q: e.target.value } }))} /></label>
                  <label>From<select value={row(i).w} onChange={e => setPlan(p => ({ ...p, [i.id]: { ...row(i), w: e.target.value } }))}>
                    {data.warehouses.length === 0 && <option value="">No warehouse</option>}
                    {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name} ({qty(freeIn(i.product_id, w.id))} free)</option>)}</select></label>
                </div>
              ) : <em>{money(lineQty(i) * Number(i.unit_price))}</em>}
            </li>))}
          </ul>
          {po.supplier_note && !["new"].includes(s) && <p className="sp-note"><b>Your note:</b> {po.supplier_note}</p>}
          {po.cancel_reason && <p className="sp-note err"><b>Reason:</b> {po.cancel_reason}</p>}
          {["dispatched", "delivered"].includes(s) && <p className="sp-muted">This order has left your warehouse and can no longer be changed.{s === "dispatched" && " TradeLink marks it delivered."}</p>}
          {!["dispatched", "delivered", "rejected", "cancelled"].includes(s) && (
            <label>Note {s === "new" ? <em>(reason needed to reject)</em> : <em>(needed to cancel)</em>}<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} /></label>)}
          {err && <p className="sp-note err" role="alert">{err}</p>}
          <div className="sp-actions wrap">
            <button className="sp-btn line" onClick={download}><Download size={16} /> Order document</button>
            {s === "new" && <><button className="sp-btn line danger" disabled={busy} onClick={() => (note.trim().length < 3 ? need("Rejecting") : void act("reject"))}>Reject</button><button className="sp-btn primary" disabled={busy} onClick={() => void accept()}>{busy ? "Working…" : "Accept order"}</button></>}
            {s === "accepted" && <button className="sp-btn primary" disabled={busy} onClick={() => void act("prepare")}>Start preparing</button>}
            {s === "preparing" && <button className="sp-btn primary" disabled={busy} onClick={() => void act("ready")}>Mark ready for pickup</button>}
            {s === "ready_for_pickup" && <button className="sp-btn primary" disabled={busy} onClick={() => void act("dispatch")}>Dispatch order</button>}
            {["accepted", "preparing", "ready_for_pickup"].includes(s) && <button className="sp-btn line danger" disabled={busy} onClick={() => (note.trim().length < 3 ? need("Cancelling") : void act("cancel"))}>Cancel order</button>}
          </div>
        </div>)}
    </Modal>
  );
}

export default function Orders() {
  const [f, setF] = useState(0), [open, setOpen] = useState<PO | null>(null);
  const { data, error, loading, reload } = useLoad(async () => {
    const { data, error } = await requireSupabase().from("purchase_orders").select("*").order("created_at", { ascending: false }).limit(300);
    if (error) throw error; return (data ?? []) as PO[];
  });
  const shown = useMemo(() => (data ?? []).filter(o => !FILTERS[f][1].length || FILTERS[f][1].includes(o.status)), [data, f]);
  return (
    <>
      <div className="sp-tabs" role="tablist">{FILTERS.map(([l], i) => <button key={l} role="tab" aria-selected={f === i} className={f === i ? "on" : ""} onClick={() => setF(i)}>{l}{l === "New" && (data ?? []).some(o => o.status === "new") && <i>{(data ?? []).filter(o => o.status === "new").length}</i>}</button>)}</div>
      {loading ? <Spinner /> : error ? <p className="sp-note err" role="alert">{error}</p> : shown.length === 0 ? (
        <section className="sp-card"><p className="sp-empty"><PackageOpen size={24} />No orders here yet. Purchase orders from stores appear as soon as TradeLink receives them.</p></section>
      ) : (
        <section className="sp-card flush"><ul className="sp-rows orders">{shown.map(o => (
          <li key={o.id}><button onClick={() => setOpen(o)}><b>{o.po_number}</b><span>{o.store_name}</span><Pill s={o.status} /><em>{money(o.total_amount)}</em><small>{dateOf(o.created_at)}</small></button></li>))}</ul></section>)}
      {open && <Detail po={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void reload(); }} />}
    </>
  );
}
