import { useState } from "react";
import { BadgeCheck, Building2, FileText, Mail, MapPin, Phone, ShieldCheck, ShieldQuestion } from "lucide-react";
import { PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip } from "../Records";
import { documentLink } from "../../pages/supplier/files";
import { requireSupabase, type Supplier } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, Tabs, callRpc, dateOf, useAction, useLoad } from "../suite";

type Check = { supplier_id: string; identity_ok: boolean; registration_ok: boolean; address_ok: boolean; contact_ok: boolean; notes: string | null; verified_at: string | null };
type Row = Supplier & { check: Check | null };
const ITEMS: { key: keyof Pick<Check, "identity_ok" | "registration_ok" | "address_ok" | "contact_ok">; text: string; icon: typeof FileText }[] = [
  { key: "identity_ok", text: "Owner identity matches the documents", icon: BadgeCheck },
  { key: "registration_ok", text: "Business registration / licence is valid", icon: FileText },
  { key: "address_ok", text: "Business address confirmed", icon: MapPin },
  { key: "contact_ok", text: "Phone or email confirmed by contacting them", icon: Phone },
];
const done = (c: Check | null) => (c ? ITEMS.filter(i => c[i.key]).length : 0);

export default function Verification() {
  const { can, search } = useAdmin();
  const [tab, setTab] = useState<"todo" | "verified" | "all">("todo");
  const [open, setOpen] = useState<Row | null>(null);
  const list = useLoad(async () => {
    const sb = requireSupabase();
    const [s, c] = await Promise.all([
      sb.from("suppliers").select("*").order("created_at", { ascending: false }),
      sb.from("supplier_checks").select("*"),
    ]);
    if (s.error) throw s.error;
    if (c.error) throw c.error;
    const by = new Map(((c.data ?? []) as Check[]).map(x => [x.supplier_id, x]));
    return ((s.data ?? []) as Supplier[]).map(x => ({ ...x, check: by.get(x.id) ?? null }));
  }, []);
  const rows = list.data ?? [];
  const isV = (r: Row) => !!r.check?.verified_at;
  const q = search.toLowerCase();
  const shown = rows.filter(r => (tab === "all" || (tab === "verified" ? isV(r) : !isV(r))) && `${r.name} ${r.owner_name ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      <PageHeading title="Supplier Verification" sub="Confirm who a supplier really is before they sell or get paid." />
      <ErrorNote text={list.error} />
      <SummaryStrip items={[
        { icon: <ShieldCheck />, tone: "mint", value: rows.filter(isV).length, label: "Verified" },
        { icon: <ShieldQuestion />, tone: "gold", value: rows.filter(r => !isV(r)).length, label: "Not verified" },
        { icon: <Building2 />, tone: "blue", value: rows.length, label: "Suppliers" },
      ]} />
      <Tabs label="Verification views" value={tab} onChange={setTab} tabs={[
        { id: "todo", label: "To verify", icon: <ShieldQuestion />, count: rows.filter(r => !isV(r)).length },
        { id: "verified", label: "Verified", icon: <ShieldCheck /> },
        { id: "all", label: "All", icon: <Building2 /> },
      ]} />
      {!shown.length ? <div className="empty-state"><ShieldCheck size={34} /><p>{list.loading ? "Loading…" : tab === "todo" ? "Every supplier is verified." : "No suppliers here yet."}</p></div> : (
        <div className="su-grid">
          {shown.map(r => (
            <article className="su-card" key={r.id}>
              <h3>{r.name}{isV(r) ? <StatusChip tone="good" icon={<ShieldCheck size={14} />}>Verified</StatusChip> : <StatusChip tone="warn">{done(r.check)}/4 checks</StatusChip>}</h3>
              <p>{r.owner_name || "Owner not given"} · {r.status ?? "approved"}</p>
              <p className="su-muted">{(r.documents ?? []).length} document{(r.documents ?? []).length === 1 ? "" : "s"} uploaded{isV(r) ? ` · verified ${dateOf(r.check?.verified_at)}` : ""}</p>
              <div className="su-row end"><button className="btn outline" onClick={() => setOpen(r)}>{can("verification.manage") ? "Review checks" : "View"}</button></div>
            </article>
          ))}
        </div>
      )}
      {open && <CheckModal row={open} canEdit={can("verification.manage")} onClose={() => setOpen(null)} onDone={() => { setOpen(null); list.reload(); }} />}
    </>
  );
}

function CheckModal({ row, canEdit, onClose, onDone }: { row: Row; canEdit: boolean; onClose: () => void; onDone: () => void }) {
  const { notify } = useAdmin();
  const { busy, run } = useAction();
  const [v, setV] = useState({ identity_ok: !!row.check?.identity_ok, registration_ok: !!row.check?.registration_ok, address_ok: !!row.check?.address_ok, contact_ok: !!row.check?.contact_ok });
  const [notes, setNotes] = useState(row.check?.notes ?? "");
  const all = Object.values(v).every(Boolean);
  const openDoc = async (path: string) => { try { window.open(await documentLink(path), "_blank", "noopener,noreferrer"); } catch (e) { notify((e as Error).message); } };
  const save = async () => {
    const ok = await run(() => callRpc("set_supplier_checks", { p_supplier: row.id, p_identity: v.identity_ok, p_registration: v.registration_ok, p_address: v.address_ok, p_contact: v.contact_ok, p_notes: notes }), all ? "Supplier verified." : "Checks saved.");
    if (ok) onDone();
  };
  return (
    <Modal title={row.name} kicker="SUPPLIER VERIFICATION" onClose={onClose}>
      <div className="su-row su-muted" style={{ marginBottom: 10 }}>
        {row.phone && <span><Phone size={13} /> {row.phone}</span>}{row.email && <span><Mail size={13} /> {row.email}</span>}{row.address && <span><MapPin size={13} /> {row.address}</span>}
      </div>
      <div className="su-row" style={{ marginBottom: 12 }}>
        {(row.documents ?? []).length === 0 ? <span className="su-muted">No documents uploaded.</span> : (row.documents ?? []).map(d => <button key={d.path} className="su-ico-btn" onClick={() => void openDoc(d.path)}><FileText size={14} />{d.name}</button>)}
      </div>
      <Form onSubmit={() => void save()} busy={busy} submit={all ? "Save and verify" : "Save checks"}>
        {ITEMS.map(i => (
          <label key={i.key} className={`su-check${v[i.key] ? " on" : ""}`} style={{ fontWeight: 500 }}>
            <input type="checkbox" disabled={!canEdit} checked={v[i.key]} onChange={e => setV({ ...v, [i.key]: e.target.checked })} /><i.icon size={16} />{i.text}
          </label>
        ))}
        <label>Notes<textarea maxLength={500} disabled={!canEdit} value={notes} onChange={e => setNotes(e.target.value)} placeholder="What you checked and how" /></label>
        <p className="su-muted">A supplier counts as verified only when all four checks are ticked. Verified suppliers can be paid.</p>
      </Form>
    </Modal>
  );
}
