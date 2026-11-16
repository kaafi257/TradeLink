import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { Edit3, ImagePlus, Plus, Trash2, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { INDUSTRY_ICONS, IconFor } from "../../lib/icons";
import { errorText, requireSupabase, type Category, type Industry } from "../../lib/supabase";
import { IMAGE_ACCEPT, checkImage, removeProductImage, uploadProductImage } from "../../lib/upload";
import { useAdmin } from "../AdminData";

type ModalState = { kind: "industry"; editing: Industry | null } | { kind: "category"; editing: Category | null; industryId: string };

function Modal({ kicker, title, onClose, children }: { kicker: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">{kicker}</small><h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function IndustryModal({ editing, onClose }: { editing: Industry | null; onClose: () => void }) {
  const { notify, reload, industries } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [icon, setIcon] = useState(editing?.icon || "package");
  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const row = {
      name: String(f.get("name") ?? "").trim(), description: String(f.get("description") ?? "").trim() || null, icon,
      sort_order: Number(f.get("sort_order") || 100), active: f.get("active") === "on",
    };
    setBusy(true);
    try {
      const t = requireSupabase().from("industries");
      const { error } = editing ? await t.update(row).eq("id", editing.id) : await t.insert(row);
      if (error) throw error;
      notify("Industry saved.");
      onClose();
      await reload();
    } catch (err) { notify((err as { code?: string })?.code === "23505" ? "An industry with that name already exists." : errorText(err, "Could not save the industry")); }
    finally { setBusy(false); }
  };
  return (
    <Modal kicker="CATALOGUE" title={editing ? "Edit industry" : "Add an industry"} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>Industry name<input name="name" required minLength={2} maxLength={60} defaultValue={editing?.name} placeholder="e.g. Electronics" /></label>
        <label>Icon
          <span className="icon-pick"><span className="icon-preview"><IconFor name={icon} size={22} /></span>
            <select value={icon} onChange={e => setIcon(e.target.value)}>{Object.entries(INDUSTRY_ICONS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
          </span>
        </label>
        <label className="full">Short description<input name="description" maxLength={200} defaultValue={editing?.description || ""} placeholder="Shown on the website under the industry name" /></label>
        <label>Display order<input name="sort_order" type="number" step="1" defaultValue={editing?.sort_order ?? (industries.length + 1) * 10} /><small>Smaller numbers show first.</small></label>
        <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /> Show on the public website</label>
        <button className="btn green full" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add industry"}</button>
      </form>
    </Modal>
  );
}

function CategoryModal({ editing, industryId, onClose }: { editing: Category | null; industryId: string; onClose: () => void }) {
  const { notify, reload, industries, categories } = useAdmin();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const shown = preview ?? (removed ? null : editing?.image_url ?? null);
  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    const problem = checkImage(f);
    if (problem) { notify(problem); return; }
    setFile(f); setRemoved(false);
  };

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const inId = String(f.get("industry_id") ?? "");
    const row: Record<string, unknown> = {
      industry_id: inId, name: String(f.get("name") ?? "").trim(), description: String(f.get("description") ?? "").trim() || null,
      sort_order: Number(f.get("sort_order") || 100), active: f.get("active") === "on",
    };
    setBusy(true);
    let uploaded: string | null = null;
    try {
      row.image_url = file ? (uploaded = await uploadProductImage(file)) : removed ? null : editing?.image_url ?? null;
      const t = requireSupabase().from("categories");
      const { error } = editing ? await t.update(row).eq("id", editing.id) : await t.insert(row);
      if (error) throw error;
      if ((file || removed) && editing?.image_url) void removeProductImage(editing.image_url);
      notify("Category saved.");
      onClose();
      await reload();
    } catch (err) {
      if (uploaded) void removeProductImage(uploaded);
      notify((err as { code?: string })?.code === "23505" ? "That industry already has a category with this name." : errorText(err, "Could not save the category"));
    } finally { setBusy(false); }
  };
  return (
    <Modal kicker="CATALOGUE" title={editing ? "Edit category" : "Add a category"} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>Industry<select name="industry_id" required defaultValue={editing?.industry_id || industryId}>{industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label>Category name<input name="name" required minLength={2} maxLength={60} defaultValue={editing?.name} placeholder="e.g. Smartphones" /></label>
        <label className="full">Short description<input name="description" maxLength={200} defaultValue={editing?.description || ""} /></label>
        <div className="full image-field">
          <span className="image-label">Category picture (shown on the homepage)</span>
          <div className="image-drop">
            {shown ? <img src={shown} alt="Category preview" /> : <div className="image-empty"><ImagePlus /><b>No picture yet</b><small>A coloured tile with the industry icon is used instead.</small></div>}
            <div className="image-actions">
              <button type="button" className="btn outline" onClick={() => fileRef.current?.click()}><ImagePlus /> {shown ? "Replace picture" : "Choose picture"}</button>
              {shown && <button type="button" className="btn outline" onClick={() => { setFile(null); setRemoved(true); }}>Remove</button>}
            </div>
            <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} onChange={pick} hidden />
          </div>
        </div>
        <label>Display order<input name="sort_order" type="number" step="1" defaultValue={editing?.sort_order ?? (categories.filter(c => c.industry_id === industryId).length + 1) * 10} /></label>
        <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active ?? true} /> Show on the public website</label>
        <button className="btn green full" type="submit" disabled={busy}>{busy ? (file ? "Uploading picture…" : "Saving…") : editing ? "Save changes" : "Add category"}</button>
      </form>
    </Modal>
  );
}

export default function CategoriesPage() {
  const { industries, categories, products, can, search, notify, reload } = useAdmin();
  const [modal, setModal] = useState<ModalState | null>(null);
  const canEdit = can("catalogue.manage");
  const s = search.toLowerCase();
  const countFor = (catId: string) => products.filter(p => p.category_id === catId).length;

  const remove = async (table: "industries" | "categories", id: string, name: string, imageUrl?: string | null) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone. (To just hide it from the website, edit it and untick "Show on the public website".)`)) return;
    try {
      const { error } = await requireSupabase().from(table).delete().eq("id", id);
      if (error) {
        if ((error as { code?: string }).code === "23503") throw new Error(`"${name}" still has ${table === "industries" ? "categories" : "products"} in it. Move or delete those first, or hide it instead.`);
        throw error;
      }
      if (imageUrl) void removeProductImage(imageUrl);
      notify("Deleted.");
      await reload();
    } catch (e) { notify(errorText(e, "Could not delete")); }
  };

  return (
    <>
      <PageHeading title="Industries & Categories" sub="Add a new industry or category here and it appears on the website and in the product form. No code changes needed."
        action={canEdit ? <button className="btn gold" onClick={() => setModal({ kind: "industry", editing: null })}><Plus /> Add industry</button> : undefined} />
      {!canEdit && <p className="inline-note">You can view the catalogue structure. Only the owner (or a manager with permission) can change it.</p>}
      {!industries.length && <div className="table-panel"><div className="empty-state"><p>No industries yet. Run migration 0005 in Supabase, or add your first industry.</p></div></div>}
      <div className="industry-list">
        {industries.map(ind => {
          const cats = categories.filter(c => c.industry_id === ind.id && (!s || `${c.name} ${ind.name}`.toLowerCase().includes(s)));
          if (s && !cats.length && !ind.name.toLowerCase().includes(s)) return null;
          return (
            <section className="table-panel industry-panel" key={ind.id}>
              <header className="industry-head">
                <span className="industry-icon"><IconFor name={ind.icon} size={22} /></span>
                <div><h3>{ind.name} {!ind.active && <span className="status muted">hidden</span>}</h3><small>{ind.description || "No description"}</small></div>
                {canEdit && (
                  <div className="industry-actions">
                    <button className="btn outline" onClick={() => setModal({ kind: "category", editing: null, industryId: ind.id })}><Plus size={15} /> Add category</button>
                    <button className="icon-action" aria-label={`Edit ${ind.name}`} onClick={() => setModal({ kind: "industry", editing: ind })}><Edit3 size={16} /></button>
                    <button className="icon-action" aria-label={`Delete ${ind.name}`} onClick={() => void remove("industries", ind.id, ind.name)}><Trash2 size={16} /></button>
                  </div>
                )}
              </header>
              <div className="table-scroll"><table className="rt rt-s">
                <thead><tr><th>Category</th><th>Products</th><th>Order</th><th>Status</th>{canEdit && <th>Action</th>}</tr></thead>
                <tbody>
                  {cats.map(c => (
                    <tr key={c.id}>
                      <td data-label="Category"><div className="table-product">{c.image_url ? <img src={c.image_url} alt="" /> : <span className="thumb-icon"><IconFor name={ind.icon} size={18} /></span>}<b>{c.name}</b></div></td>
                      <td data-label="Products">{countFor(c.id)}</td><td data-label="Order">{c.sort_order}</td>
                      <td data-label="Status"><span className={`status ${c.active ? "good" : "muted"}`}>{c.active ? "Visible" : "Hidden"}</span></td>
                      {canEdit && <td data-label="Action" data-actions>
                        <button className="icon-action" aria-label={`Edit ${c.name}`} onClick={() => setModal({ kind: "category", editing: c, industryId: ind.id })}><Edit3 size={16} /></button>{" "}
                        <button className="icon-action" aria-label={`Delete ${c.name}`} onClick={() => void remove("categories", c.id, c.name, c.image_url)}><Trash2 size={16} /></button>
                      </td>}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!cats.length && <div className="empty-state"><p>No categories in this industry yet.</p></div>}
              </div>
            </section>
          );
        })}
      </div>
      {modal?.kind === "industry" && <IndustryModal editing={modal.editing} onClose={() => setModal(null)} />}
      {modal?.kind === "category" && <CategoryModal editing={modal.editing} industryId={modal.industryId} onClose={() => setModal(null)} />}
    </>
  );
}
