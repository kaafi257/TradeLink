import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Building2, CheckCircle2, ClipboardCheck, FileText, ImagePlus, Loader2, ShieldCheck, Store, Upload, X } from "lucide-react";
import { Brand } from "../../components/Brand";
import { TURNSTILE_SITE_KEY, Turnstile } from "../../components/Turnstile";
import { isSupabaseConfigured, requireSupabase, supabase, type BusinessType, type PublicIndustry, type SupplierDocument } from "../../lib/supabase";
import { DOC_ACCEPT, LOGO_ACCEPT, MAX_DOCS, checkDoc, checkLogo, uploadDocument, uploadLogo } from "./files";
import "./supplier.css";

export const BUSINESS_TYPES: { id: BusinessType; label: string }[] = [
  { id: "manufacturer", label: "Manufacturer / producer" }, { id: "wholesaler", label: "Wholesaler" }, { id: "distributor", label: "Distributor" },
  { id: "importer", label: "Importer" }, { id: "retailer", label: "Retailer" }, { id: "farmer", label: "Farmer / grower" },
  { id: "service", label: "Service provider" }, { id: "other", label: "Other" },
];

/** The function answers errors as JSON {error}; supabase-js hides that inside error.context. */
async function functionError(err: unknown): Promise<string> {
  const ctx = (err as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try { const b = await ctx.json(); if (typeof b?.error === "string") return b.error; } catch { /* fall through */ }
  }
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (/failed to send|fetch|not found|404/i.test(msg)) return "Supplier registration is not available yet. Please contact TradeLink.";
  return msg || "Registration failed. Please try again.";
}

const STEPS = [
  { Icon: ClipboardCheck, title: "Register", text: "Tell us about your business." },
  { Icon: ShieldCheck, title: "We review", text: "TradeLink checks your application." },
  { Icon: Store, title: "Start selling", text: "Sign in once approved." },
];

export default function SupplierRegister() {
  const navigate = useNavigate();
  const [industries, setIndustries] = useState<PublicIndustry[]>([]);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [docs, setDocs] = useState<File[]>([]);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ warnings: string[] } | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.from("public_industries").select("*").order("sort_order").order("name").then(r => { if (!r.error) setIndustries((r.data ?? []) as PublicIndustry[]); });
  }, []);
  useEffect(() => {
    if (!logo) { setLogoPreview(null); return undefined; }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => { URL.revokeObjectURL(url); };
  }, [logo]);

  const pickLogo = (f: File | undefined) => {
    if (!f) return;
    const problem = checkLogo(f);
    if (problem) { setError(problem); return; }
    setError(""); setLogo(f);
  };
  const addDocs = (list: FileList | null) => {
    if (!list) return;
    const next = [...docs];
    for (const f of Array.from(list)) {
      const problem = checkDoc(f);
      if (problem) { setError(problem); return; }
      if (next.length >= MAX_DOCS) { setError(`You can attach up to ${MAX_DOCS} documents.`); break; }
      if (!next.some(d => d.name === f.name && d.size === f.size)) next.push(f);
    }
    setDocs(next);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    if (g("password") !== String(f.get("password2") ?? "")) { setError("The two passwords do not match."); return; }
    if (TURNSTILE_SITE_KEY && !token) { setError("Please complete the security check."); return; }
    setBusy(true);
    try {
      const db = requireSupabase();
      const body = {
        business_name: g("business_name"), industry_id: g("industry_id"), business_type: g("business_type"), location: g("location"), address: g("address"), about: g("about"),
        owner_name: g("owner_name"), phone: g("phone"), email: g("email"), password: String(f.get("password") ?? ""), website: g("website"), token,
      };
      const { data, error: fnError } = await db.functions.invoke("register-supplier", { body });
      if (fnError) throw new Error(await functionError(fnError));
      if (data?.error) throw new Error(String(data.error));

      // Signed in as the new supplier, the files go straight into their own private folder.
      const warnings: string[] = [];
      const supplierId = data?.supplier_id as string | undefined;
      const signIn = await db.auth.signInWithPassword({ email: body.email, password: body.password });
      if (signIn.error || !supplierId) {
        if (logo || docs.length) warnings.push("Your files could not be uploaded yet. Sign in and add them from Business profile.");
      } else {
        const patch: { logo_path?: string; documents?: SupplierDocument[] } = {};
        if (logo) { try { patch.logo_path = await uploadLogo(supplierId, logo); } catch (err) { warnings.push(`Logo: ${(err as Error).message}`); } }
        const uploaded: SupplierDocument[] = [];
        for (const d of docs) { try { uploaded.push(await uploadDocument(supplierId, d)); } catch (err) { warnings.push((err as Error).message); } }
        if (uploaded.length) patch.documents = uploaded;
        if (patch.logo_path || patch.documents) {
          const { error: upErr } = await db.from("suppliers").update(patch).eq("id", supplierId);
          if (upErr) warnings.push("Your files were uploaded but could not be attached. Add them again from Business profile.");
        }
      }
      setDone({ warnings });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed. Please try again.");
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="sp sp-auth"><div className="sp-auth-card sp-done">
        <CheckCircle2 size={44} className="ok" />
        <h1>Application received</h1>
        <p>Thank you. TradeLink will review your business. You can sign in at any time to see the status. You will be able to publish products once your account is approved.</p>
        {done.warnings.length > 0 && <ul className="sp-warn">{done.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
        <button className="sp-btn primary" onClick={() => navigate("/supplier")}>Go to my portal</button>
      </div></div>
    );
  }

  return (
    <div className="sp sp-auth">
      <aside className="sp-auth-side">
        <Brand light />
        <h1>Sell your products on TradeLink</h1>
        <p>Reach individual and business buyers across industries. Register your business and we will review it.</p>
        <ol>{STEPS.map(({ Icon, title, text }, i) => <li key={title}><span><Icon size={18} /></span><div><b>{i + 1}. {title}</b><small>{text}</small></div></li>)}</ol>
      </aside>
      <main className="sp-auth-main">
        <form className="sp-auth-card" onSubmit={e => void submit(e)} noValidate={false}>
          <div className="sp-auth-brand"><Brand /></div>
          <h2>Supplier registration</h2>
          {!isSupabaseConfigured && <p className="sp-note warn">Supabase is not configured yet.</p>}

          <fieldset>
            <legend><Building2 size={16} /> Business</legend>
            <label>Business name<input name="business_name" required minLength={2} maxLength={80} autoComplete="organization" /></label>
            <div className="row">
              <label>Industry
                <select name="industry_id" required defaultValue="">
                  <option value="" disabled>Choose an industry</option>
                  {industries.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
              <label>Business type
                <select name="business_type" required defaultValue="">
                  <option value="" disabled>Choose a type</option>
                  {BUSINESS_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              </label>
            </div>
            <div className="row">
              <label>City / region<input name="location" required minLength={2} maxLength={80} placeholder="e.g. Dire Dawa" /></label>
              <label>Street address <em>(optional)</em><input name="address" maxLength={200} autoComplete="street-address" /></label>
            </div>
            <label>About the business<textarea name="about" required minLength={10} maxLength={300} rows={3} placeholder="What you sell and who you serve (shown on your public profile)" /></label>
          </fieldset>

          <fieldset>
            <legend><FileText size={16} /> Owner and contact</legend>
            <label>Owner's full name<input name="owner_name" required minLength={2} maxLength={120} autoComplete="name" /></label>
            <div className="row">
              <label>Phone<input name="phone" type="tel" required minLength={6} maxLength={40} autoComplete="tel" placeholder="+251…" /></label>
              <label>Email (your login)<input name="email" type="email" required maxLength={160} autoComplete="email" /></label>
            </div>
            <p className="sp-note">Your phone and email are private. They are never shown on the public site.</p>
            <div className="row">
              <label>Password<input name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
              <label>Repeat password<input name="password2" type="password" required minLength={8} maxLength={72} autoComplete="new-password" /></label>
            </div>
          </fieldset>

          <fieldset>
            <legend><ImagePlus size={16} /> Logo and documents <em>(optional now, you can add them later)</em></legend>
            <div className="sp-files">
              <div className="sp-logo-pick">
                <button type="button" className="sp-logo-box" onClick={() => logoInput.current?.click()} aria-label="Choose a logo">
                  {logoPreview ? <img src={logoPreview} alt="Logo preview" /> : <ImagePlus size={24} />}
                </button>
                <div><b>Business logo</b><small>JPG, PNG or WebP</small>
                  {logo && <button type="button" className="sp-link" onClick={() => setLogo(null)}>Remove</button>}</div>
                <input ref={logoInput} type="file" accept={LOGO_ACCEPT} hidden onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
              <div className="sp-docs">
                <button type="button" className="sp-btn line sm" onClick={() => docInput.current?.click()}><Upload size={15} /> Add documents</button>
                <small>Business licence, tax or ID. PDF, JPG or PNG, 5 MB each.</small>
                <input ref={docInput} type="file" accept={DOC_ACCEPT} multiple hidden onChange={e => { addDocs(e.target.files); e.target.value = ""; }} />
                {docs.length > 0 && <ul>{docs.map(d => <li key={d.name + d.size}><FileText size={14} /> <span>{d.name}</span><button type="button" aria-label={`Remove ${d.name}`} onClick={() => setDocs(l => l.filter(x => x !== d))}><X size={14} /></button></li>)}</ul>}
              </div>
            </div>
          </fieldset>

          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="sp-hp" />
          {TURNSTILE_SITE_KEY && <Turnstile onToken={setToken} />}
          {error && <p className="sp-note err" role="alert">{error}</p>}
          <button className="sp-btn primary wide" type="submit" disabled={busy || !isSupabaseConfigured}>{busy ? <><Loader2 size={16} className="spin" /> Submitting…</> : "Submit application"}</button>
          <p className="sp-foot">Already registered? <Link to="/login">Sign in</Link> · <Link to="/">Back to TradeLink</Link></p>
        </form>
      </main>
    </div>
  );
}
