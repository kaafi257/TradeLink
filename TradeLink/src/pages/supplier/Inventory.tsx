import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertTriangle, Boxes, Plus, Search, Warehouse as WIcon } from "lucide-react";
import { errorText, requireSupabase } from "../../lib/supabase";
import { Modal, Spinner, dateTime, qty, useLoad, type SProduct, type StockRow, type Warehouse } from "./ops";

type Move = { id: number; product_id: string; warehouse_id: string; kind: string; quantity: number; available_after: number; reference: string | null; note: string | null; actor_name: string | null; created_at: string };
const KIND: Record<string, string> = { receive: "Stock received", remove: "Stock removed", damage: "Marked damaged", incoming_add: "Incoming added", incoming_receive: "Incoming received", reserve: "Reserved for order", release: "Reservation released", dispatch: "Dispatched" };
const ACTIONS: [string, string][] = [["receive", "Receive stock"], ["remove", "Remove stock"], ["damage", "Mark damaged"], ["incoming_add", "Add incoming stock"], ["incoming_receive", "Incoming stock arrived"]];

function Adjust({ product, warehouses, onClose, onDone }: { product: SProduct; warehouses: Warehouse[]; onClose: () => void; onDone: () => void }) {
  const active = warehouses.filter(w => w.active);
  const [wh, setWh] = useState(active[0]?.id ?? ""), [kind, setKind] = useState("receive"), [n, setN] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const { error } = await requireSupabase().rpc("supplier_adjust_stock", { p_product: product.id, p_warehouse: wh, p_kind: kind, p_qty: Number(n), p_note: note.trim() || null });
    setBusy(false);
    if (error) setErr(errorText(error, "Could not update stock")); else onDone();
  };
  return (
    <Modal title={`Update stock: ${product.name}`} onClose={onClose}>
      <form className="sp-form" onSubmit={e => void submit(e)}>
        {active.length === 0 ? <p className="sp-note warn">Add a warehouse first (Warehouses tab).</p> : <>
          <label>Warehouse<select value={wh} onChange={e => setWh(e.target.value)}>{active.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <label>What happened<select value={kind} onChange={e => setKind(e.target.value)}>{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Quantity ({product.unit})<input type="number" inputMode="decimal" min="0.001" step="any" value={n} onChange={e => setN(e.target.value)} required /></label>
          <label>Note {["remove", "damage"].includes(kind) ? <em>(required)</em> : <em>(optional)</em>}<input value={note} onChange={e => setNote(e.target.value)} maxLength={300} required={["remove", "damage"].includes(kind)} /></label></>}
        {err && <p className="sp-note err" role="alert">{err}</p>}
        <div className="sp-actions"><button type="button" className="sp-btn line" onClick={onClose}>Cancel</button><button className="sp-btn primary" disabled={busy || !wh}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

function WarehouseForm({ row, onClose, onDone }: { row: Warehouse | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(row?.name ?? ""), [address, setAddress] = useState(row?.address ?? ""), [active, setActive] = useState(row?.active ?? true);
  const [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const body = { name: name.trim(), address: address.trim() || null, active };
    const db = requireSupabase();
    const { error } = row ? await db.from("supplier_warehouses").update(body).eq("id", row.id) : await db.from("supplier_warehouses").insert(body);
    setBusy(false);
    if (error) setErr(/duplicate key/i.test(error.message) ? "You already have a warehouse with that name." : errorText(error, "Could not save the warehouse")); else onDone();
  };
  return (
    <Modal title={row ? "Edit warehouse" : "Add a warehouse"} onClose={onClose}>
      <form className="sp-form" onSubmit={e => void submit(e)}>
        <label>Name<input value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={80} /></label>
        <label>Address<input value={address} onChange={e => setAddress(e.target.value)} maxLength={200} /></label>
        <label className="sp-check"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> In use</label>
        {err && <p className="sp-note err" role="alert">{err}</p>}
        <div className="sp-actions"><button type="button" className="sp-btn line" onClick={onClose}>Cancel</button><button className="sp-btn primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button></div>
      </form>
    </Modal>
  );
}

export default function Inventory() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"stock" | "moves" | "wh">("stock");
  const [q, setQ] = useState("");
  const [adj, setAdj] = useState<SProduct | null>(null);
  const [whEdit, setWhEdit] = useState<Warehouse | null | undefined>(undefined);
  const { data, error, loading, reload } = useLoad(async () => {
    const db = requireSupabase();
    const [p, w, s, m] = await Promise.all([
      db.from("supplier_products").select("*").order("name"),
      db.from("supplier_warehouses").select("*").order("name"),
      db.from("supplier_stock").select("*"),
      db.from("supplier_stock_movements").select("*").order("created_at", { ascending: false }).limit(150),
    ]);
    for (const r of [p, w, s, m]) if (r.error) throw r.error;
    return { products: (p.data ?? []) as SProduct[], warehouses: (w.data ?? []) as Warehouse[], stock: (s.data ?? []) as StockRow[], moves: (m.data ?? []) as Move[] };
  });
  const focus = params.get("p");
  const totals = useMemo(() => {
    const t = new Map<string, { available: number; incoming: number; reserved: number; damaged: number }>();
    for (const s of data?.stock ?? []) {
      const c = t.get(s.product_id) ?? { available: 0, incoming: 0, reserved: 0, damaged: 0 };
      c.available += Number(s.available); c.incoming += Number(s.incoming); c.reserved += Number(s.reserved); c.damaged += Number(s.damaged); t.set(s.product_id, c);
    }
    return t;
  }, [data]);
  const pname = useMemo(() => new Map((data?.products ?? []).map(p => [p.id, p.name])), [data]);
  const wname = useMemo(() => new Map((data?.warehouses ?? []).map(w => [w.id, w.name])), [data]);
  if (loading) return <Spinner />;
  if (!data) return <p className="sp-note err" role="alert">{error}</p>;
  const rows = data.products.filter(p => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <div className="sp-tabs" role="tablist">
        {([["stock", "Stock"], ["moves", "Movements"], ["wh", "Warehouses"]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === "stock" && <>
        <div className="sp-toolbar"><label className="sp-search"><Search size={16} /><input placeholder="Search products" value={q} onChange={e => setQ(e.target.value)} aria-label="Search stock" /></label></div>
        {rows.length === 0 ? <section className="sp-card"><p className="sp-empty"><Boxes size={24} /> Add products first, then record the stock you hold.</p></section> : (
          <ul className="sp-cards">{rows.map(p => {
            const t = totals.get(p.id) ?? { available: 0, incoming: 0, reserved: 0, damaged: 0 };
            const low = p.reorder_level > 0 && t.available <= p.reorder_level;
            return (
              <li key={p.id} className={`sp-icard${focus === p.id ? " focus" : ""}`}>
                <div className="meta"><b>{p.name}</b><small>{p.sku ? `SKU ${p.sku} · ` : ""}{p.unit}{p.status !== "approved" && " · not approved yet"}</small>
                  {low && <span className="sp-pill bad"><AlertTriangle size={12} /> Low stock</span>}</div>
                <dl className="nums"><div><dt>Available</dt><dd>{qty(t.available)}</dd></div><div><dt>Incoming</dt><dd>{qty(t.incoming)}</dd></div><div><dt>Reserved</dt><dd>{qty(t.reserved)}</dd></div><div><dt>Damaged</dt><dd>{qty(t.damaged)}</dd></div></dl>
                <button className="sp-btn line sm" onClick={() => setAdj(p)}>Update stock</button>
              </li>);
          })}</ul>)}
      </>}
      {tab === "moves" && (data.moves.length === 0 ? <section className="sp-card"><p className="sp-empty">No stock changes recorded yet.</p></section> : (
        <section className="sp-card flush"><ul className="sp-rows moves">{data.moves.map(m => (
          <li key={m.id}><div><b>{pname.get(m.product_id) ?? "Product"}</b><small>{wname.get(m.warehouse_id) ?? "Warehouse"}{m.reference && ` · ${m.reference}`}{m.note && ` · ${m.note}`}</small></div>
            <span>{KIND[m.kind] ?? m.kind} <b>{qty(m.quantity)}</b></span><small>{m.actor_name ?? "System"} · {dateTime(m.created_at)}</small></li>))}</ul></section>))}
      {tab === "wh" && <>
        <div className="sp-toolbar"><span /><button className="sp-btn primary" onClick={() => setWhEdit(null)}><Plus size={16} /> Add warehouse</button></div>
        {data.warehouses.length === 0 ? <section className="sp-card"><p className="sp-empty"><WIcon size={24} /> Add a warehouse before recording stock.</p></section> : (
          <ul className="sp-cards">{data.warehouses.map(w => (
            <li key={w.id} className={`sp-icard${w.active ? "" : " off"}`}><div className="meta"><b>{w.name}</b><small>{w.address || "No address"}{!w.active && " · not in use"}</small></div><button className="sp-btn line sm" onClick={() => setWhEdit(w)}>Edit</button></li>))}</ul>)}
      </>}
      {adj && <Adjust product={adj} warehouses={data.warehouses} onClose={() => setAdj(null)} onDone={() => { setAdj(null); void reload(); }} />}
      {whEdit !== undefined && <WarehouseForm row={whEdit} onClose={() => setWhEdit(undefined)} onDone={() => { setWhEdit(undefined); void reload(); }} />}
    </>
  );
}
