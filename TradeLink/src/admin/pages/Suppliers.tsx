import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, ClipboardCheck, Edit3, ExternalLink, EyeOff, FileText, MapPin, Plus, Trash2, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconFor } from "../../lib/icons";
import { errorText, requireSupabase, type Supplier, type SupplierStatus } from "../../lib/supabase";
import { BUSINESS_TYPES } from "../../pages/supplier/Register";
import { documentLink, logoUrl } from "../../pages/supplier/files";
import { useAdmin } from "../AdminData";

type Row = Supplier & { cats: string[] };
const STATUS_LABEL: Record<SupplierStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Needs changes", suspended: "Suspended" };
const STATUS_TONE: Record<SupplierStatus, string> = { pending: "warn", approved: "good", rejected: "bad", suspended: "muted" };
const dateOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");

/** Owner / manager decision on a supplier application: approve, reject (with reason), suspend, reactivate. */
function ReviewModal({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { industries, notify } = useAdmin();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rate, setRate] = useState(String(row.fee_rate ?? 0));
  const status = row.status ?? "approved";
  const ind = industries.find(i => i.id === row.industry_id);
  const type = BUSINESS_TYPES.find(t => t.id === row.business_type)?.label;
  const logo = logoUrl(row.logo_path);
  const docs = row.documents ?? [];
  const needsNote = (a: string) => a === "reject" || a === "suspend";

  const act = async (action: "approve" | "reject" | "suspend" | "reactivate") => {
    if (needsNote(action) && note.trim().length < 5) { notify("Please write the reason first, so the supplier knows what to fix."); return; }
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc("review_supplier", { p_id: row.id, p_action: action, p_note: note.trim() || null });
      if (error) throw error;
      notify(action === "approve" ? "Supplier approved." : action === "reject" ? "Application sent back with your note." : action === "suspend" ? "Supplier suspended." : "Supplier reactivated.");
      onDone(); onClose();
    } catch (e) { notify(errorText(e, "Could not update the supplier")); } finally { setBusy(false); }
  };
  const saveRate = async () => {
    const n = Number(rate);
    if (!Number.isFinite(n) || n < 0 || n > 100) { notify("Enter a commission between 0 and 100."); return; }
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc("set_supplier_fee_rate", { p_supplier: row.id, p_rate: n });
      if (error) throw error;
      notify("Commission saved."); onDone();
    } catch (e) { notify(errorText(e, "Could not save the commission")); } finally { setBusy(false); }
  };
  const open = async (path: string) => { try { window.open(await documentLink(path), "_blank", "noopener,noreferrer"); } catch (e) { notify((e as Error).message); } };

  return (
    <div className="modal-backdrop">
      <div className="modal wide-modal" role="dialog" aria-modal="true" aria-label={`Review ${row.name}`}>
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">SUPPLIER REVIEW</small>
        <h2>{row.name} <span className={`status ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span></h2>
        <div className="review-grid">
          <div className="review-block">
            <h4>Business</h4>
            <div className="review-logo">{logo ? <img src={logo} alt="Logo" /> : <Building2 />}</div>
            <dl>
              <dt>Industry</dt><dd>{ind?.name ?? "—"}</dd>
              <dt>Type</dt><dd>{type ?? "—"}</dd>
              <dt>Location</dt><dd>{[row.location, row.address].filter(Boolean).join(", ") || "—"}</dd>
              <dt>Registered</dt><dd>{dateOf(row.created_at)}</dd>
            </dl>
            {status === "approved" && (
              <div className="rate-row"><label htmlFor="fee-rate">Commission %</label>
                <input id="fee-rate" type="number" min="0" max="100" step="0.5" inputMode="decimal" value={rate} onChange={e => setRate(e.target.value)} />
                <button className="btn" disabled={busy} onClick={() => void saveRate()}>Save</button></div>
            )}
            {row.about && <p className="review-about">{row.about}</p>}
          </div>
          <div className="review-block">
            <h4>Owner and contact <small>private</small></h4>
            <dl>
              <dt>Owner</dt><dd>{row.owner_name || "—"}</dd>
              <dt>Phone</dt><dd>{row.phone || "—"}</dd>
              <dt>Email</dt><dd>{row.email || "—"}</dd>
            </dl>
            <h4>Documents</h4>
            {docs.length === 0 ? <p className="muted-text">No documents uploaded.</p> : (
              <ul className="review-docs">{docs.map(d => <li key={d.path}><FileText size={15} /><span>{d.name}</span><button className="icon-action" aria-label={`Open ${d.name}`} onClick={() => void open(d.path)}><ExternalLink size={15} /></button></li>)}</ul>
            )}
            {row.status_note && <p className="review-note"><b>Last note to supplier</b>{row.status_note}</p>}
            {row.reviewed_at && <p className="muted-text">Last decision: {dateOf(row.reviewed_at)}</p>}
          </div>
        </div>
        <div className="review-actions">
          {(status === "pending" || status === "approved" || status === "rejected") && status !== "approved" && (
            <label className="full">Message to the supplier <em>(required to reject or suspend)</em>
              <textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. The business licence photo is unreadable. Please upload a clearer copy." />
            </label>
          )}
          {status === "approved" && (
            <label className="full">Reason for suspension
              <textarea rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="Explain why this supplier is being suspended." />
            </label>
          )}
          {status === "suspended" && <p className="muted-text">Suspended suppliers are hidden from the public site until reactivated.</p>}
          <div className="review-buttons">
            {(status === "pending" || status === "rejected") && <button className="btn green" disabled={busy} onClick={() => void act("approve")}>Approve</button>}
            {status === "pending" && <button className="btn danger" disabled={busy} onClick={() => void act("reject")}>Reject with note</button>}
            {status === "approved" && <button className="btn danger" disabled={busy} onClick={() => void act("suspend")}>Suspend</button>}
            {status === "suspended" && <button className="btn green" disabled={busy} onClick={() => void act("reactivate")}>Reactivate</button>}
            <button className="btn" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupplierModal({ editing, onClose, onSaved }: { editing: Row | null; onClose: () => void; onSaved: () => void }) {
  const { industries, categories, notify } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [industryId, setIndustryId] = useState(editing?.industry_id ?? industries[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set(editing?.cats ?? []));
  const choices = categories.filter(c => c.industry_id === industryId);
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const row = {
      name: String(f.get("name") ?? "").trim(), industry_id: industryId,
      location: String(f.get("location") ?? "").trim() || null, about: String(f.get("about") ?? "").trim() || null,
      active: f.get("active") === "on",
    };
    setBusy(true);
    try {
      const db = requireSupabase();
      let id = editing?.id;
      if (editing) { const { error } = await db.from("suppliers").update(row).eq("id", editing.id); if (error) throw error; }
      else { const { data, error } = await db.from("suppliers").insert(row).select("id").single(); if (error) throw error; id = data.id as string; }
      // Replace the category links with what is ticked (only categories of the chosen industry).
      const keep = choices.filter(c => picked.has(c.id)).map(c => c.id);
      const del = await db.from("supplier_categories").delete().eq("supplier_id", id!);
      if (del.error) throw del.error;
      if (keep.length) { const ins = await db.from("supplier_categories").insert(keep.map(category_id => ({ supplier_id: id, category_id }))); if (ins.error) throw ins.error; }
      notify("Supplier saved.");
      onSaved(); onClose();
    } catch (err) { notify((err as { code?: string })?.code === "23505" ? "A supplier with that name already exists." : errorText(err, "Could not save the supplier")); }
    finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? "Edit supplier" : "Add a supplier"}>
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">DIRECTORY</small><h2>{editing ? "Edit supplier" : "Add a supplier"}</h2>
        <form className="form-grid" onSubmit={save}>
          <label>Business name<input name="name" required minLength={2} maxLength={80} defaultValue={editing?.name} /></label>
          <label>Industry
            <select value={industryId} onChange={e => { setIndustryId(e.target.value); setPicked(new Set()); }} required>
              {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </label>
          <label>Location<input name="location" maxLength={80} defaultValue={editing?.location || ""} placeholder="e.g. Dire Dawa" /></label>
          <label className="full">Short description<input name="about" maxLength={300} defaultValue={editing?.about || ""} placeholder="Shown on the website" /></label>
          <div className="full">
            <span className="field-label">Product categories</span>
            {choices.length === 0 ? <small>This industry has no categories yet. Add them in Industries &amp; Categories.</small>
              : <div className="chip-pick">{choices.map(c => <label key={c.id} className="checkbox-label"><input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}</label>)}</div>}
          </div>
          <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /> Show on the public website</label>
          <small className="full">Only the name, industry, location, description and categories are shown publicly. Private contact details are not stored here.</small>
          <button className="btn green full" type="submit" disabled={busy || !industryId}>{busy ? "Saving…" : editing ? "Save changes" : "Add supplier"}</button>
        </form>
      </div>
    </div>
  );
}

export default function SuppliersPage() {
  const { industries, categories, can, search, notify, profile } = useAdmin();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [modal, setModal] = useState<{ editing: Row | null } | null>(null);
  const [review, setReview] = useState<Row | null>(null);
  const [filter, setFilter] = useState<"all" | SupplierStatus>("all");
  const canEdit = can("catalogue.manage");
  const canReview = profile.role === "owner" || profile.role === "manager";

  const load = useCallback(async () => {
    const db = requireSupabase();
    const [s, l] = await Promise.all([db.from("suppliers").select("*").order("name"), db.from("supplier_categories").select("*")]);
    if (s.error || l.error) { setFailed(true); setRows([]); return; }
    const links = (l.data ?? []) as { supplier_id: string; category_id: string }[];
    setFailed(false);
    setRows(((s.data ?? []) as Supplier[]).map(x => ({ ...x, cats: links.filter(k => k.supplier_id === x.id).map(k => k.category_id) })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  const remove = async (r: Row) => {
    if (!window.confirm(`Delete "${r.name}"? This cannot be undone. (To just hide it, edit it and untick "Show on the public website".)`)) return;
    try { const { error } = await requireSupabase().from("suppliers").delete().eq("id", r.id); if (error) throw error; notify("Deleted."); await load(); }
    catch (e) { notify(errorText(e, "Could not delete")); }
  };

  const s = search.toLowerCase();
  const counts = (rows ?? []).reduce((m, r) => ({ ...m, [r.status ?? "approved"]: (m[r.status ?? "approved"] ?? 0) + 1 }), {} as Record<string, number>);
  const list = (rows ?? []).filter(r => (filter === "all" || (r.status ?? "approved") === filter) && (!s || `${r.name} ${r.location ?? ""} ${r.owner_name ?? ""}`.toLowerCase().includes(s)));
  return (
    <>
      <PageHeading title="Suppliers" sub="Businesses listed in the website's supplier directory. Only suppliers you leave visible are shown to visitors."
        action={canEdit ? <button className="btn gold" onClick={() => setModal({ editing: null })}><Plus /> Add supplier</button> : undefined} />
      {rows && rows.length > 0 && (
        <div className="status-tabs" role="group" aria-label="Filter by status">
          {([["all", "All"], ["pending", "Pending"], ["approved", "Approved"], ["rejected", "Needs changes"], ["suspended", "Suspended"]] as const).map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}{id === "all" ? ` (${rows.length})` : counts[id] ? ` (${counts[id]})` : ""}{id === "pending" && counts.pending ? <i aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      )}
      {failed && <div className="table-panel"><div className="empty-state"><p>The suppliers table is not set up yet. Run migration 0007_home_marketplace.sql in Supabase.</p></div></div>}
      {!failed && rows && rows.length === 0 && <div className="table-panel"><div className="empty-state"><Building2 /><p>No suppliers yet</p></div></div>}
      {list.length > 0 && (
        <div className="table-panel"><div className="table-scroll"><table className="rt rt-s">
          <thead><tr><th>Supplier</th><th>Industry</th><th>Location</th><th>Categories</th><th>Status</th>{(canEdit || canReview) && <th>Action</th>}</tr></thead>
          <tbody>
            {list.map(r => {
              const ind = industries.find(i => i.id === r.industry_id);
              return (
                <tr key={r.id}>
                  <td data-label="Supplier"><div className="table-product"><span className="thumb-icon"><IconFor name={ind?.icon} size={18} /></span><b>{r.name}</b></div></td>
                  <td data-label="Industry">{ind?.name ?? "—"}</td>
                  <td data-label="Location">{r.location ? <><MapPin size={13} /> {r.location}</> : "—"}</td>
                  <td data-label="Categories">{r.cats.map(id => categories.find(c => c.id === id)?.name).filter(Boolean).join(", ") || "—"}</td>
                  <td data-label="Status">
                    {r.profile_id ? <span className={`status ${STATUS_TONE[r.status ?? "approved"]}`}>{STATUS_LABEL[r.status ?? "approved"]}</span>
                      : <span className={`status ${r.active ? "good" : "muted"}`}>{r.active ? "Visible" : <><EyeOff size={13} /> Hidden</>}</span>}
                  </td>
                  {(canEdit || canReview) && <td data-label="Action" data-actions>
                    {canReview && r.profile_id && <button className="icon-action" aria-label={`Review ${r.name}`} title="Review application" onClick={() => setReview(r)}><ClipboardCheck size={16} /></button>}{" "}
                    {canEdit && <button className="icon-action" aria-label={`Edit ${r.name}`} onClick={() => setModal({ editing: r })}><Edit3 size={16} /></button>}{" "}
                    {canEdit && <button className="icon-action" aria-label={`Delete ${r.name}`} onClick={() => void remove(r)}><Trash2 size={16} /></button>}
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table></div></div>
      )}
      {review && <ReviewModal row={review} onClose={() => setReview(null)} onDone={() => void load()} />}
      {modal && <SupplierModal editing={modal.editing} onClose={() => setModal(null)} onSaved={() => void load()} />}
    </>
  );
}
