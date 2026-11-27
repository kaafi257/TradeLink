import { useEffect, useRef, useState, type FormEvent } from "react";
import { MapPin, Building2, ExternalLink, FileText, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { errorText, requireSupabase, type SupplierDocument } from "../../lib/supabase";
import ShareLocation from "../../components/ShareLocation";
import type { Fix } from "../../lib/gps";
import { BUSINESS_TYPES } from "./Register";
import { useSupplier } from "./context";
import { DOC_ACCEPT, LOGO_ACCEPT, MAX_DOCS, documentLink, logoUrl, removeStored, uploadDocument, uploadLogo } from "./files";

/** Business details, logo and documents. Name changes are only possible until the first approval; industry and fees are TradeLink's. */
export default function Profile() {
  const { supplier, profile, refresh } = useSupplier();
  const [busy, setBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [shop, setShop] = useState<{ lat: number; lng: number; capturedAt: string } | null>(null);
  useEffect(() => { void requireSupabase().rpc("supplier_my_shop_location").then(r => { if (!r.error) setShop((r.data ?? null) as typeof shop); }); }, []);
  const saveShop = async (f: Fix) => {
    try {
      const { error } = await requireSupabase().rpc("supplier_set_shop_location", { p_lat: f.lat, p_lng: f.lng, p_accuracy: f.accuracy });
      if (error) throw error;
      setShop({ lat: f.lat, lng: f.lng, capturedAt: new Date().toISOString() }); say(true, "Shop location saved.");
    } catch (err) { say(false, errorText(err, "Could not save your shop location")); }
  };
  const logoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);
  if (!supplier) return null;
  const nameLocked = (supplier.status ?? "pending") !== "pending";
  const docs = supplier.documents ?? [];
  const logo = logoUrl(supplier.logo_path);
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    const row: Record<string, unknown> = {
      owner_name: g("owner_name"), phone: g("phone"), email: g("email"), location: g("location"),
      address: g("address") || null, about: g("about") || null, business_type: g("business_type") || null,
    };
    if (!nameLocked) row.name = g("name");
    setBusy(true); setMsg(null);
    try {
      const { error } = await requireSupabase().from("suppliers").update(row).eq("id", supplier.id);
      if (error) throw error;
      await refresh(); say(true, "Saved.");
    } catch (err) {
      say(false, (err as { code?: string })?.code === "23505" ? "A business with that name already exists." : errorText(err, "Could not save your details"));
    } finally { setBusy(false); }
  };

  const patch = async (p: { logo_path?: string | null; documents?: SupplierDocument[] }) => {
    const { error } = await requireSupabase().from("suppliers").update(p).eq("id", supplier.id);
    if (error) throw error;
    await refresh();
  };
  const changeLogo = async (file: File | undefined) => {
    if (!file) return;
    setFileBusy("logo"); setMsg(null);
    try { const old = supplier.logo_path; const path = await uploadLogo(supplier.id, file); await patch({ logo_path: path }); await removeStored("supplier-logos", old); say(true, "Logo updated."); }
    catch (err) { say(false, (err as Error).message); } finally { setFileBusy(""); }
  };
  const addDocs = async (list: FileList | null) => {
    if (!list || !list.length) return;
    if (docs.length + list.length > MAX_DOCS) { say(false, `You can keep up to ${MAX_DOCS} documents.`); return; }
    setFileBusy("docs"); setMsg(null);
    try {
      const added: SupplierDocument[] = [];
      for (const f of Array.from(list)) added.push(await uploadDocument(supplier.id, f));
      await patch({ documents: [...docs, ...added] }); say(true, added.length === 1 ? "Document added." : "Documents added.");
    } catch (err) { say(false, (err as Error).message); } finally { setFileBusy(""); }
  };
  const removeDoc = async (d: SupplierDocument) => {
    if (!window.confirm(`Remove “${d.name}”?`)) return;
    setFileBusy("docs"); setMsg(null);
    try { await patch({ documents: docs.filter(x => x.path !== d.path) }); await removeStored("supplier-documents", d.path); say(true, "Document removed."); }
    catch (err) { say(false, errorText(err, "Could not remove the document")); } finally { setFileBusy(""); }
  };
  const openDoc = async (d: SupplierDocument) => {
    try { window.open(await documentLink(d.path), "_blank", "noopener,noreferrer"); } catch (err) { say(false, (err as Error).message); }
  };

  return (
    <div className="sp-grid two">
      <form className="sp-card sp-form" onSubmit={e => void save(e)}>
        <h3>Business details</h3>
        <label>Business name<input name="name" defaultValue={supplier.name} required minLength={2} maxLength={80} disabled={nameLocked} />
          {nameLocked && <small>To change the name of an approved business, contact TradeLink.</small>}</label>
        <div className="row">
          <label>Business type
            <select name="business_type" defaultValue={supplier.business_type ?? ""}>
              <option value="">Choose a type</option>
              {BUSINESS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label>City / region<input name="location" defaultValue={supplier.location ?? ""} required minLength={2} maxLength={80} /></label>
        </div>
        <label>Street address<input name="address" defaultValue={supplier.address ?? ""} maxLength={200} /></label>
        <label>About the business <small>(public)</small><textarea name="about" rows={3} maxLength={300} defaultValue={supplier.about ?? ""} /></label>
        <h3>Owner and contact <small>private</small></h3>
        <label>Owner's full name<input name="owner_name" defaultValue={supplier.owner_name ?? ""} required minLength={2} maxLength={120} /></label>
        <div className="row">
          <label>Phone<input name="phone" type="tel" defaultValue={supplier.phone ?? ""} required minLength={6} maxLength={40} /></label>
          <label>Contact email<input name="email" type="email" defaultValue={supplier.email ?? ""} required maxLength={160} /></label>
        </div>
        <p className="sp-muted">Your sign-in email is {profile.email}. Industry and fees can only be changed by TradeLink.</p>
        {msg && <p className={`sp-note ${msg.ok ? "ok" : "err"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        <button className="sp-btn primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      </form>

      <div className="sp-stack">
        <section className="sp-card">
          <h3><MapPin size={17} /> Shop location</h3>
          {shop
            ? <p className="sp-muted">Your shop location is saved ({new Date(shop.capturedAt).toLocaleDateString()}) and locked. Drivers collect orders from this point. To change it, contact TradeLink.</p>
            : <>
                <p className="sp-muted">Not saved yet. Drivers need it to find your shop. Do this while you are inside your shop. You can save it once, and only TradeLink can change it afterwards.</p>
                <ShareLocation fix={null} onFix={() => {}} confirm={saveShop} label="Share my shop location" doneLabel="Saved" />
              </>}
        </section>
        <section className="sp-card">
          <h3>Logo</h3>
          <div className="sp-logo-pick">
            <span className="sp-logo big">{logo ? <img src={logo} alt="Your logo" /> : <Building2 size={30} />}</span>
            <div>
              <button className="sp-btn line sm" disabled={fileBusy === "logo"} onClick={() => logoInput.current?.click()}>{fileBusy === "logo" ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />} {logo ? "Change logo" : "Add logo"}</button>
              <small>JPG, PNG or WebP. Shown on your public profile.</small>
            </div>
            <input ref={logoInput} type="file" accept={LOGO_ACCEPT} hidden onChange={e => { void changeLogo(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </section>
        <section className="sp-card">
          <div className="sp-card-head"><h3>Business documents</h3>
            <button className="sp-btn line sm" disabled={fileBusy === "docs" || docs.length >= MAX_DOCS} onClick={() => docInput.current?.click()}>{fileBusy === "docs" ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Add</button></div>
          <input ref={docInput} type="file" accept={DOC_ACCEPT} multiple hidden onChange={e => { void addDocs(e.target.files); e.target.value = ""; }} />
          <p className="sp-muted">Private. Only TradeLink's owner and managers can open these. PDF, JPG or PNG, 5 MB each.</p>
          {docs.length === 0 ? <p className="sp-empty small"><FileText size={20} /> No documents yet</p> : (
            <ul className="sp-doclist">{docs.map(d => (
              <li key={d.path}><FileText size={16} /><span>{d.name}</span>
                <button className="sp-icon" aria-label={`Open ${d.name}`} onClick={() => void openDoc(d)}><ExternalLink size={16} /></button>
                <button className="sp-icon" aria-label={`Remove ${d.name}`} onClick={() => void removeDoc(d)}><Trash2 size={16} /></button></li>
            ))}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
