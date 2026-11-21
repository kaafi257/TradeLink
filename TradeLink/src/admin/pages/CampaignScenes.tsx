import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Edit3, Eye, EyeOff, Plus, RotateCcw, Trash2, X } from "lucide-react";
import Campaign, { ACTION_LABEL, DEFAULT_SLIDES, SCENE_LABEL } from "../../pages/market/Campaign";
import { uploadProductImage } from "../../lib/upload";
import { errorText, requireSupabase, type CampaignAction, type CampaignScene, type CampaignSlide } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const MAX_SCENES = 8;
const blank = (order: number): CampaignSlide => ({ id: "", scene: "wholesale", tag: "", title: "", body: "", cta_label: "", cta_action: "shop_wholesale", sort_order: order, active: true });

function SceneModal({ editing, order, onClose, onSaved }: { editing: CampaignSlide | null; order: number; onClose: () => void; onSaved: () => void }) {
  const { notify } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<CampaignSlide>(editing ?? blank(order));
  const set = <K extends keyof CampaignSlide>(k: K, v: CampaignSlide[K]) => setF(x => ({ ...x, [k]: v }));
  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try { set("image_url", await uploadProductImage(file)); } catch (err) { notify(errorText(err, "Could not upload the image")); } finally { setBusy(false); }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const row = { scene: f.scene, tag: f.tag.trim(), title: f.title.trim(), body: f.body.trim(), cta_label: f.cta_label.trim(), cta_action: f.cta_action, sort_order: f.sort_order, active: f.active ?? true, image_url: f.image_url || null };
    setBusy(true);
    try {
      const t = requireSupabase().from("campaign_slides");
      const { error } = editing ? await t.update(row).eq("id", editing.id) : await t.insert(row);
      if (error) throw error;
      notify("Scene saved."); onSaved(); onClose();
    } catch (err) { notify(errorText(err, "Could not save the scene")); } finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? "Edit scene" : "Add a scene"}>
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">MARKETING</small><h2>{editing ? "Edit scene" : "Add a scene"}</h2>
        <form className="form-grid" onSubmit={save}>
          <label>Animation
            <select value={f.scene} onChange={e => set("scene", e.target.value as CampaignScene)}>{Object.entries(SCENE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <div className="full mk-img">
            <span>Promotion picture <small>(shown on the homepage, next to the welcome text)</small></span>
            {f.image_url && <img src={f.image_url} alt="" />}
            <div><label className="btn outline mk-up">{f.image_url ? "Change picture" : "Upload picture"}<input type="file" accept="image/*" hidden onChange={e => void pick(e.target.files?.[0])} /></label>
              {f.image_url && <button type="button" className="btn outline" onClick={() => set("image_url", null)}>Remove</button>}</div>
          </div>
          <label>Label <input required maxLength={24} value={f.tag} onChange={e => set("tag", e.target.value)} placeholder="e.g. Wholesale" /><small>Small tag above the headline.</small></label>
          <label className="full">Headline <input required maxLength={70} value={f.title} onChange={e => set("title", e.target.value)} placeholder="e.g. Buy in bulk, straight from suppliers" /><small>{f.title.length}/70</small></label>
          <label className="full">Text <textarea maxLength={160} rows={3} value={f.body} onChange={e => set("body", e.target.value)} placeholder="One or two short sentences" /><small>{f.body.length}/160</small></label>
          <label>Button text <input required maxLength={28} value={f.cta_label} onChange={e => set("cta_label", e.target.value)} placeholder="e.g. Shop wholesale" /></label>
          <label>Button opens
            <select value={f.cta_action} onChange={e => set("cta_action", e.target.value as CampaignAction)}>{Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="checkbox-label"><input type="checkbox" checked={f.active ?? true} onChange={e => set("active", e.target.checked)} /> Show on the website</label>
          <button className="btn green full" type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add scene"}</button>
        </form>
      </div>
    </div>
  );
}

/** Admin -> Marketing: manage the animated campaign on the public homepage (scenes, wording, buttons, order, on/off). Needs migration 0017. */
export default function CampaignScenes({ canEdit = true }: { canEdit?: boolean }) {
  const { notify, search } = useAdmin();
  const [rows, setRows] = useState<CampaignSlide[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [modal, setModal] = useState<{ editing: CampaignSlide | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await requireSupabase().from("campaign_slides").select("*").order("sort_order").order("created_at");
    if (error) { setMissing(true); setRows([]); return; }
    setMissing(false); setRows((data ?? []) as CampaignSlide[]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => PromiseLike<{ error: unknown }>, ok?: string) => {
    setBusy(true);
    try { const { error } = await fn(); if (error) throw error; if (ok) notify(ok); await load(); }
    catch (err) { notify(errorText(err, "Could not update the campaign")); } finally { setBusy(false); }
  };
  const toggle = (r: CampaignSlide) => act(() => requireSupabase().from("campaign_slides").update({ active: !r.active }).eq("id", r.id));
  const remove = (r: CampaignSlide) => { if (window.confirm(`Delete the scene "${r.title}"?`)) void act(() => requireSupabase().from("campaign_slides").delete().eq("id", r.id), "Scene deleted."); };
  const move = async (i: number, d: -1 | 1) => {
    if (!rows) return; const a = rows[i], b = rows[i + d]; if (!a || !b) return;
    // Renumber the whole list so ties never leave the order unchanged.
    const next = rows.map(r => r.id).filter(Boolean); [next[i], next[i + d]] = [next[i + d], next[i]];
    await act(async () => { for (let k = 0; k < next.length; k++) { const { error } = await requireSupabase().from("campaign_slides").update({ sort_order: (k + 1) * 10 }).eq("id", next[k]); if (error) return { error }; } return { error: null }; });
  };
  const restore = () => act(() => requireSupabase().from("campaign_slides").insert(DEFAULT_SLIDES.map(({ scene, tag, title, body, cta_label, cta_action, sort_order }) => ({ scene, tag, title, body, cta_label, cta_action, sort_order, active: true }))), "Default scenes added.");

  const q = search.trim().toLowerCase();
  const shown = useMemo(() => (rows ?? []).filter(r => !q || `${r.tag} ${r.title} ${r.body}`.toLowerCase().includes(q)), [rows, q]);
  const live = (rows ?? []).filter(r => r.active);

  return (
    <>
      {canEdit && !missing && rows && <div className="mk-bar"><button className="btn green" disabled={rows.length >= MAX_SCENES} onClick={() => setModal({ editing: null })}><Plus size={16} /> Add scene</button></div>}
      {missing && (
        <div className="notice"><p><b>Campaign settings are not installed yet.</b> Run <code>supabase/migrations/0020_campaign_slides.sql</code> in the Supabase SQL Editor, then reload this page. Until then the website plays its four built-in scenes.</p></div>
      )}
      {!missing && rows && (
        <>
          <section className="table-panel" aria-label="Live preview">
            <header className="industry-head"><div><h3>Live preview</h3><small>{live.length ? `${live.length} scene${live.length === 1 ? "" : "s"} on the website. Buttons are disabled here.` : "No scene is switched on, so the campaign is hidden on the website."}</small></div></header>
            <div className="mk-preview">{live.length ? <Campaign slides={live} products={0} suppliers={0} industries={0} onShop={() => {}} onRegister={() => {}} onQuote={() => {}} preview /> : <div className="empty-state"><p>Campaign hidden</p></div>}</div>
          </section>

          <section className="table-panel" aria-label="Scenes">
            <header className="industry-head"><div><h3>Scenes</h3><small>Scenes play in this order, about 5 seconds each. Up to {MAX_SCENES}.</small></div></header>
            <div className="table-scroll"><table className="rt rt-s">
              <thead><tr><th>Order</th><th>Scene</th><th>Button</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {shown.map(r => { const i = rows.indexOf(r); return (
                  <tr key={r.id}>
                    <td data-label="Order"><button className="icon-action" aria-label="Move up" disabled={busy || i === 0 || !!q} onClick={() => void move(i, -1)}><ArrowUp size={15} /></button>{" "}
                      <button className="icon-action" aria-label="Move down" disabled={busy || i === rows.length - 1 || !!q} onClick={() => void move(i, 1)}><ArrowDown size={15} /></button></td>
                    <td data-label="Scene"><b>{r.title}</b><br /><small>{r.tag} · {SCENE_LABEL[r.scene]}</small></td>
                    <td data-label="Button">{r.cta_label}<br /><small>{ACTION_LABEL[r.cta_action]}</small></td>
                    <td data-label="Status"><span className={`status ${r.active ? "good" : "muted"}`}>{r.active ? "On" : "Off"}</span></td>
                    <td data-label="Action" data-actions>
                      <button className="icon-action" aria-label={r.active ? "Switch off" : "Switch on"} title={r.active ? "Switch off" : "Switch on"} disabled={busy} onClick={() => void toggle(r)}>{r.active ? <EyeOff size={16} /> : <Eye size={16} />}</button>{" "}
                      <button className="icon-action" aria-label={`Edit ${r.title}`} onClick={() => setModal({ editing: r })}><Edit3 size={16} /></button>{" "}
                      <button className="icon-action" aria-label={`Delete ${r.title}`} disabled={busy} onClick={() => remove(r)}><Trash2 size={16} /></button>
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
            {rows.length === 0 && <div className="empty-state"><p>No scenes yet</p><button className="btn outline" disabled={busy} onClick={() => void restore()}><RotateCcw size={15} /> Add the four default scenes</button></div>}
            </div>
          </section>
        </>
      )}
      {modal && <SceneModal editing={modal.editing} order={(Math.max(0, ...(rows ?? []).map(r => r.sort_order))) + 10} onClose={() => setModal(null)} onSaved={() => void load()} />}
    </>
  );
}
