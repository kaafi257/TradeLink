import { useMemo, useState } from "react";
import { CheckCircle2, CircleHelp, Plus, RotateCcw, Search as SearchIcon, XCircle } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip, type Tone } from "../Records";
import { money } from "../../lib/format";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, callRpc, dateOf, label, useAction, useLoad } from "../suite";

type Row = {
  id: string; ref: string; kind: "return" | "dispute"; order_id: string; customer_name: string; phone: string | null; product_name: string | null; quantity: number | null;
  reason: string; status: string; resolution: string | null; refund_amount: number; notes: string | null; created_at: string; orders: { order_number: string } | null; suppliers: { name: string } | null;
};
const TONE: Record<string, Tone> = { open: "warn", investigating: "info", approved: "good", rejected: "bad", resolved: "good" };

export default function Returns() {
  const { can, orders, search } = useAdmin();
  const [filter, setFilter] = useState("all");
  const [modal, setModal] = useState<"new" | Row | null>(null);
  const list = useLoad(async () => {
    const { data, error } = await requireSupabase().from("returns_disputes").select("*, orders(order_number), suppliers(name)").order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as unknown as Row[];
  }, []);
  const rows = list.data ?? [];
  const count = (st: string) => rows.filter(r => r.status === st).length;
  const s = search.toLowerCase();
  const shown = rows.filter(r => (filter === "all" || r.status === filter) && `${r.ref} ${r.customer_name} ${r.product_name ?? ""} ${r.orders?.order_number ?? ""}`.toLowerCase().includes(s));
  const edit = can("returns.manage");

  return (
    <>
      <PageHeading title="Returns & Disputes" sub="Log and resolve customer returns and disputes against real orders." action={edit ? <button className="btn green" onClick={() => setModal("new")}><Plus size={16} /> New case</button> : undefined} />
      <ErrorNote text={list.error} />
      <SummaryStrip items={[
        { icon: <CircleHelp />, tone: "gold", value: count("open"), label: "Open" },
        { icon: <SearchIcon />, tone: "blue", value: count("investigating"), label: "Investigating" },
        { icon: <CheckCircle2 />, tone: "mint", value: count("approved") + count("resolved"), label: "Approved / resolved" },
        { icon: <XCircle />, tone: "red", value: count("rejected"), label: "Rejected" },
      ]} />
      <div className="su-bar">
        <select aria-label="Filter by status" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All cases</option>{["open", "investigating", "approved", "rejected", "resolved"].map(x => <option key={x} value={x}>{label(x)}</option>)}
        </select>
      </div>
      <DataTable headers={["Case", "Type", "Order", "Customer", "Product", "Status", "Refund", "Opened", "Actions"]} isEmpty={!shown.length} empty={list.loading ? "Loading…" : "No cases yet. When a customer reports a problem, log it here."}>
        {shown.map(r => (
          <tr key={r.id}><td><span className="docno">{r.ref}</span></td><td>{label(r.kind)}</td><td>{r.orders?.order_number ?? "—"}</td><td>{r.customer_name}</td>
            <td>{r.product_name ? `${r.product_name}${r.quantity ? ` × ${Number(r.quantity)}` : ""}` : "Whole order"}</td>
            <td><StatusChip tone={TONE[r.status] ?? "muted"}>{label(r.status)}</StatusChip></td>
            <td>{r.resolution === "refund" ? money(Number(r.refund_amount)) : r.resolution ? label(r.resolution) : "—"}</td><td>{dateOf(r.created_at)}</td>
            <td><button className="btn outline" onClick={() => setModal(r)}>{edit && !["rejected", "resolved"].includes(r.status) ? "Review" : "View"}</button></td></tr>
        ))}
      </DataTable>
      {modal === "new" && <NewCase orders={orders} onClose={() => setModal(null)} onDone={() => { setModal(null); list.reload(); }} />}
      {modal && modal !== "new" && <ReviewCase row={modal} canEdit={edit} onClose={() => setModal(null)} onDone={() => { setModal(null); list.reload(); }} />}
    </>
  );
}

function NewCase({ orders, onClose, onDone }: { orders: ReturnType<typeof useAdmin>["orders"]; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [orderId, setOrderId] = useState("");
  const [kind, setKind] = useState("return");
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const order = useMemo(() => orders.find(o => o.id === orderId), [orders, orderId]);
  const submit = async () => {
    const ok = await run(() => callRpc("open_return", { p_order: orderId, p_kind: kind, p_product: product || null, p_quantity: qty ? Number(qty) : null, p_reason: reason }), "Case opened.");
    if (ok) onDone();
  };
  return (
    <Modal title="New return or dispute" kicker="CUSTOMER CASE" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Open case">
        <label>Order<select required value={orderId} onChange={e => { setOrderId(e.target.value); setProduct(""); }}><option value="">Choose an order…</option>
          {orders.filter(o => o.status !== "cancelled").map(o => <option key={o.id} value={o.id}>{o.order_number} · {o.customer_name}</option>)}</select></label>
        <div className="two">
          <label>Type<select value={kind} onChange={e => setKind(e.target.value)}><option value="return">Return</option><option value="dispute">Dispute</option></select></label>
          <label>Product (optional)<select value={product} onChange={e => setProduct(e.target.value)} disabled={!order}><option value="">Whole order</option>
            {(order?.order_items ?? []).map(i => <option key={i.product_name} value={i.product_name}>{i.product_name} ({Number(i.quantity)} {i.unit})</option>)}</select></label>
        </div>
        {product && <label>Quantity affected<input type="number" min="0.001" step="any" value={qty} onChange={e => setQty(e.target.value)} /></label>}
        <label>What happened<textarea required minLength={3} maxLength={600} value={reason} onChange={e => setReason(e.target.value)} placeholder="Damaged on arrival, wrong item, invoice disagreement…" /></label>
      </Form>
    </Modal>
  );
}

function ReviewCase({ row, canEdit, onClose, onDone }: { row: Row; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const closed = ["rejected", "resolved"].includes(row.status);
  const [status, setStatus] = useState(row.status);
  const [resolution, setResolution] = useState(row.resolution ?? "");
  const [refund, setRefund] = useState(row.refund_amount ? String(Number(row.refund_amount)) : "");
  const [notes, setNotes] = useState(row.notes ?? "");
  const submit = async () => {
    const ok = await run(() => callRpc("update_return", { p_id: row.id, p_status: status, p_resolution: resolution || null, p_refund: resolution === "refund" ? Number(refund) : 0, p_notes: notes }), "Case updated.");
    if (ok) onDone();
  };
  const info = <p className="su-muted">{row.ref} · order {row.orders?.order_number ?? "—"} · {row.customer_name}{row.phone ? ` · ${row.phone}` : ""}{row.suppliers ? ` · supplier ${row.suppliers.name}` : ""}<br />Reason: {row.reason}</p>;
  if (!canEdit || closed) return <Modal title={`${label(row.kind)} ${row.ref}`} kicker={label(row.status).toUpperCase()} onClose={onClose}>{info}{row.notes && <p>{row.notes}</p>}{row.resolution && <p><b>Resolution:</b> {label(row.resolution)}{row.resolution === "refund" ? ` · ${money(Number(row.refund_amount))}` : ""}</p>}</Modal>;
  return (
    <Modal title={`${label(row.kind)} ${row.ref}`} kicker="REVIEW CASE" onClose={onClose}>
      {info}
      <p className="su-muted">A refund here records the decision. Pay the customer yourself, and change stock in Inventory if goods came back.</p>
      <Form onSubmit={() => void submit()} busy={busy} submit="Save">
        <div className="two">
          <label>Status<select value={status} onChange={e => setStatus(e.target.value)}>{["open", "investigating", "approved", "rejected", "resolved"].map(x => <option key={x} value={x}>{label(x)}</option>)}</select></label>
          <label>Resolution<select value={resolution} onChange={e => setResolution(e.target.value)}><option value="">Not decided</option><option value="refund">Refund</option><option value="replacement">Replacement</option><option value="credit">Credit</option><option value="none">No action</option></select></label>
        </div>
        {resolution === "refund" && <label>Refund amount (ETB)<input type="number" min="0.01" step="0.01" value={refund} onChange={e => setRefund(e.target.value)} /></label>}
        <label>Notes<textarea maxLength={600} value={notes} onChange={e => setNotes(e.target.value)} /></label>
      </Form>
    </Modal>
  );
}
