import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Building2, Edit3, EyeOff, MapPin, Plus, Trash2, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconFor } from "../../lib/icons";
import { errorText, requireSupabase, type Supplier } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

type Row = Supplier & { cats: string[] };

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
  const { industries, categories, can, search, notify } = useAdmin();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [modal, setModal] = useState<{ editing: Row | null } | null>(null);
  const canEdit = can("catalogue.manage");

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
  const list = (rows ?? []).filter(r => !s || `${r.name} ${r.location ?? ""}`.toLowerCase().includes(s));
  return (
    <>
      <PageHeading title="Suppliers" sub="Businesses listed in the website's supplier directory. Only suppliers you leave visible are shown to visitors."
        action={canEdit ? <button className="btn gold" onClick={() => setModal({ editing: null })}><Plus /> Add supplier</button> : undefined} />
      {failed && <div className="table-panel"><div className="empty-state"><p>The suppliers table is not set up yet. Run migration 0007_home_marketplace.sql in Supabase.</p></div></div>}
      {!failed && rows && rows.length === 0 && <div className="table-panel"><div className="empty-state"><Building2 /><p>No suppliers yet</p></div></div>}
      {list.length > 0 && (
        <div className="table-panel"><div className="table-scroll"><table className="rt rt-s">
          <thead><tr><th>Supplier</th><th>Industry</th><th>Location</th><th>Categories</th><th>Status</th>{canEdit && <th>Action</th>}</tr></thead>
          <tbody>
            {list.map(r => {
              const ind = industries.find(i => i.id === r.industry_id);
              return (
                <tr key={r.id}>
                  <td data-label="Supplier"><div className="table-product"><span className="thumb-icon"><IconFor name={ind?.icon} size={18} /></span><b>{r.name}</b></div></td>
                  <td data-label="Industry">{ind?.name ?? "—"}</td>
                  <td data-label="Location">{r.location ? <><MapPin size={13} /> {r.location}</> : "—"}</td>
                  <td data-label="Categories">{r.cats.map(id => categories.find(c => c.id === id)?.name).filter(Boolean).join(", ") || "—"}</td>
                  <td data-label="Status"><span className={`status ${r.active ? "good" : "muted"}`}>{r.active ? "Visible" : <><EyeOff size={13} /> Hidden</>}</span></td>
                  {canEdit && <td data-label="Action" data-actions>
                    <button className="icon-action" aria-label={`Edit ${r.name}`} onClick={() => setModal({ editing: r })}><Edit3 size={16} /></button>{" "}
                    <button className="icon-action" aria-label={`Delete ${r.name}`} onClick={() => void remove(r)}><Trash2 size={16} /></button>
                  </td>}
                </tr>
              );
            })}
          </tbody>
        </table></div></div>
      )}
      {modal && <SupplierModal editing={modal.editing} onClose={() => setModal(null)} onSaved={() => void load()} />}
    </>
  );
}
