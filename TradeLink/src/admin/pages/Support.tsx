import { useEffect, useState } from "react";
import { CheckCheck, Headset, Inbox, Lock, MessageSquare, Plus, Send } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip, type Tone } from "../Records";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, callRpc, dateOf, label, useAction, useLoad } from "../suite";

type Ticket = { id: string; ref: string; customer_name: string; phone: string | null; email: string | null; subject: string; category: string; priority: string; status: string; order_id: string | null; assigned_to: string | null; created_at: string; updated_at: string };
type Msg = { id: string; kind: string; body: string; author_id: string | null; created_at: string };
const ST: Record<string, Tone> = { open: "warn", pending: "info", resolved: "good", closed: "muted" };
const PR: Record<string, Tone> = { low: "muted", normal: "info", high: "warn", urgent: "bad" };

export default function Support() {
  const { can, search, profile } = useAdmin();
  const [filter, setFilter] = useState("active");
  const [open, setOpen] = useState<Ticket | null>(null);
  const [modal, setModal] = useState(false);
  const list = useLoad(async () => {
    const { data, error } = await requireSupabase().from("support_tickets").select("*").order("updated_at", { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as Ticket[];
  }, []);
  const rows = list.data ?? [];
  const n = (st: string) => rows.filter(r => r.status === st).length;
  const s = search.toLowerCase();
  const shown = rows.filter(r => (filter === "all" || (filter === "active" ? ["open", "pending"].includes(r.status) : r.status === filter)) && `${r.ref} ${r.customer_name} ${r.subject}`.toLowerCase().includes(s));
  const edit = can("support.manage");

  return (
    <>
      <PageHeading title="Customer Support" sub="Track customer problems and reply in one place." action={edit ? <button className="btn green" onClick={() => setModal(true)}><Plus size={16} /> New ticket</button> : undefined} />
      <ErrorNote text={list.error} />
      <SummaryStrip items={[
        { icon: <Inbox />, tone: "gold", value: n("open"), label: "Open" },
        { icon: <MessageSquare />, tone: "blue", value: n("pending"), label: "Answered" },
        { icon: <CheckCheck />, tone: "mint", value: n("resolved") + n("closed"), label: "Resolved" },
      ]} />
      <div className="su-bar">
        <select aria-label="Filter tickets" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="active">Open and answered</option><option value="all">All tickets</option>{["open", "pending", "resolved", "closed"].map(x => <option key={x} value={x}>{label(x)}</option>)}
        </select>
      </div>
      <DataTable headers={["Ticket", "Customer", "Subject", "Topic", "Priority", "Status", "Updated", "Actions"]} isEmpty={!shown.length} empty={list.loading ? "Loading…" : "No tickets here."}>
        {shown.map(t => (
          <tr key={t.id}><td><span className="docno">{t.ref}</span></td><td>{t.customer_name}</td><td>{t.subject}</td><td>{label(t.category)}</td>
            <td><StatusChip tone={PR[t.priority]}>{label(t.priority)}</StatusChip></td><td><StatusChip tone={ST[t.status]}>{label(t.status)}</StatusChip></td><td>{dateOf(t.updated_at)}</td>
            <td><button className="btn outline" onClick={() => setOpen(t)}>Open</button></td></tr>
        ))}
      </DataTable>
      {modal && <NewTicket uid={profile.id} onClose={() => setModal(false)} onDone={() => { setModal(false); list.reload(); }} />}
      {open && <TicketModal t={open} uid={profile.id} canEdit={edit} onClose={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function NewTicket({ uid, onClose, onDone }: { uid: string; onClose: () => void; onDone: () => void }) {
  const { orders } = useAdmin();
  const { busy, run } = useAction();
  const [f, setF] = useState({ customer_name: "", phone: "", subject: "", category: "other", priority: "normal", order_id: "", body: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    const ok = await run(async () => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("support_tickets").insert({ customer_name: f.customer_name.trim(), phone: f.phone.trim() || null, subject: f.subject.trim(), category: f.category, priority: f.priority, order_id: f.order_id || null, created_by: uid }).select("id").single();
      if (error) throw error;
      if (f.body.trim()) { const m = await sb.from("support_messages").insert({ ticket_id: data.id, kind: "customer", body: f.body.trim(), author_id: uid }); if (m.error) throw m.error; }
    }, "Ticket created.");
    if (ok) onDone();
  };
  return (
    <Modal title="New support ticket" kicker="CUSTOMER SUPPORT" onClose={onClose}>
      <Form onSubmit={() => void submit()} busy={busy} submit="Create ticket">
        <div className="two"><label>Customer name<input required minLength={2} maxLength={80} value={f.customer_name} onChange={set("customer_name")} /></label><label>Phone<input maxLength={40} value={f.phone} onChange={set("phone")} /></label></div>
        <label>Subject<input required minLength={3} maxLength={140} value={f.subject} onChange={set("subject")} /></label>
        <div className="two">
          <label>Topic<select value={f.category} onChange={set("category")}>{["order", "payment", "delivery", "product", "account", "other"].map(x => <option key={x} value={x}>{label(x)}</option>)}</select></label>
          <label>Priority<select value={f.priority} onChange={set("priority")}>{["low", "normal", "high", "urgent"].map(x => <option key={x} value={x}>{label(x)}</option>)}</select></label>
        </div>
        <label>Related order (optional)<select value={f.order_id} onChange={set("order_id")}><option value="">None</option>{orders.map(o => <option key={o.id} value={o.id}>{o.order_number} · {o.customer_name}</option>)}</select></label>
        <label>What the customer said<textarea maxLength={2000} value={f.body} onChange={set("body")} /></label>
      </Form>
    </Modal>
  );
}

function TicketModal({ t, uid, canEdit, onClose }: { t: Ticket; uid: string; canEdit: boolean; onClose: () => void }) {
  const { staff } = useAdmin();
  const { busy, run } = useAction();
  const [status, setStatus] = useState(t.status);
  const [assignee, setAssignee] = useState(t.assigned_to ?? "");
  const [body, setBody] = useState("");
  const [note, setNote] = useState(false);
  const thread = useLoad(async () => {
    const { data, error } = await requireSupabase().from("support_messages").select("*").eq("ticket_id", t.id).order("created_at");
    if (error) throw error;
    return (data ?? []) as Msg[];
  }, [t.id]);
  useEffect(() => { setStatus(t.status); }, [t.status]);
  const who = (id: string | null) => staff.find(x => x.id === id)?.full_name || "Staff";
  const send = async () => {
    const ok = await run(async () => { const { error } = await requireSupabase().from("support_messages").insert({ ticket_id: t.id, kind: note ? "note" : "reply", body: body.trim(), author_id: uid }); if (error) throw error; }, note ? "Note saved." : "Reply saved.");
    if (ok) { setBody(""); thread.reload(); if (!note && t.status === "open") setStatus("pending"); }
  };
  const save = () => void run(async () => { const { error } = await requireSupabase().from("support_tickets").update({ status, assigned_to: assignee || null }).eq("id", t.id); if (error) throw error; }, "Ticket updated.");
  return (
    <Modal title={t.subject} kicker={`${t.ref} · ${label(t.category)}`.toUpperCase()} onClose={onClose}>
      <p className="su-muted">{t.customer_name}{t.phone ? ` · ${t.phone}` : ""}{t.email ? ` · ${t.email}` : ""} · opened {dateOf(t.created_at)}</p>
      <ErrorNote text={thread.error} />
      <div className="su-thread">
        {(thread.data ?? []).map(m => <div key={m.id} className={`su-msg${m.kind === "note" ? " note" : ""}`}><small>{m.kind === "customer" ? t.customer_name : who(m.author_id)}{m.kind === "note" ? " · internal note" : m.kind === "reply" ? " · reply" : ""} · {dateOf(m.created_at)}</small>{m.body}</div>)}
        {!thread.loading && !(thread.data ?? []).length && <p className="su-muted">No messages yet.</p>}
      </div>
      {canEdit && <>
        <Form onSubmit={() => void send()} busy={busy} submit={note ? "Add note" : "Send reply"}>
          <label>{note ? "Internal note (the customer does not see it)" : "Reply"}<textarea required maxLength={2000} value={body} onChange={e => setBody(e.target.value)} /></label>
          <label className="su-check" style={{ fontWeight: 500 }}><input type="checkbox" checked={note} onChange={e => setNote(e.target.checked)} /><Lock size={15} />Save as internal note</label>
        </Form>
        <div className="su-row" style={{ marginTop: 14 }}>
          <select aria-label="Ticket status" value={status} onChange={e => setStatus(e.target.value)} className="status-select info">{["open", "pending", "resolved", "closed"].map(x => <option key={x} value={x}>{label(x)}</option>)}</select>
          <select aria-label="Assigned to" value={assignee} onChange={e => setAssignee(e.target.value)} className="status-select info"><option value="">Unassigned</option>{staff.filter(x => x.active && x.role !== "supplier").map(x => <option key={x.id} value={x.id}>{x.full_name || x.email}</option>)}</select>
          <button className="btn outline" disabled={busy} onClick={save}><Headset size={15} /> Save ticket</button>
        </div>
      </>}
    </Modal>
  );
}
