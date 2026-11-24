import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, Eye, EyeOff, Globe, Handshake, LogIn, Lock, Mail, ShieldCheck, Store, TrendingUp, User, UserPlus } from "lucide-react";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase";
import { LANGS, useLoginText, type Lang } from "./loginText";
import LoginHero from "./LoginHero";
import "./login.css";

/** Desktop only: the screen is designed for a 1440x900 canvas and scaled to fit the real window, so nothing scrolls on short laptops and nothing floats lost on big monitors. */
function useFit(): number {
  const [z, setZ] = useState(1);
  useEffect(() => {
    const run = () => { const w = window.innerWidth, h = window.innerHeight; setZ(w > 1000 ? Math.min(1.5, Math.max(0.7, Math.min(w / 1440, h / 900))) : 1); };
    run(); window.addEventListener("resize", run);
    return () => window.removeEventListener("resize", run);
  }, []);
  return z;
}

const EMAIL_KEY = "tl-remember-email";

function LangMenu({ lang, setLang, label }: { lang: Lang; setLang: (l: Lang) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const cur = LANGS.find(l => l.id === lang) ?? LANGS[0];
  return (
    <div className="lg-lang" ref={box}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={`${label}: ${cur.name}`} onClick={() => setOpen(o => !o)}>
        <Globe size={18} /><b>{cur.short}</b><ChevronDown size={16} />
      </button>
      {open && <ul role="listbox" aria-label={label}>{LANGS.map(l => (
        <li key={l.id} role="option" aria-selected={l.id === lang}><button type="button" onClick={() => { setLang(l.id); setOpen(false); }}>{l.name}{l.id === lang && <Check size={15} />}</button></li>
      ))}</ul>}
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { session, loading, profile } = useAuth();
  const { t, lang, setLang } = useLoginText();
  const fit = useFit();
  const [email, setEmail] = useState(() => { try { return localStorage.getItem(EMAIL_KEY) ?? ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  const target = profile?.role === "supplier" ? "/supplier" : "/admin";
  // Signed in (already, or just now) goes straight through.
  useEffect(() => {
    if (loading || !session) return;
    navigate(target, { replace: true });
  }, [loading, session, target, navigate]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setInfo("");
    try {
      const { error: authError } = await requireSupabase().auth.signInWithPassword({ email: email.trim(), password });
      if (authError) throw authError;
      try { if (remember) localStorage.setItem(EMAIL_KEY, email.trim()); else localStorage.removeItem(EMAIL_KEY); } catch { /* storage blocked */ }
      void Promise.resolve(requireSupabase().rpc("log_login")).catch(() => {}); // sign-in history for the audit report
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally { setBusy(false); }
  };

  const forgot = async () => {
    setError(""); setInfo("");
    if (!email.trim()) { setError(t.needEmail); return; }
    try {
      const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password` });
      if (resetError) throw resetError;
      setInfo(t.resetSent);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send the reset email"); }
  };

  return (
    <div className="tl-login" style={{ "--z": fit } as React.CSSProperties}>
      <aside className="lg-side">
        <svg className="lg-shape" viewBox="0 0 700 900" preserveAspectRatio="none" aria-hidden="true">
          <path d="M-40 560 C140 470 330 560 440 690 S640 900 740 880 V900 H-40Z" fill="#0d4aa3" opacity=".55" />
          <path d="M-40 700 C160 640 360 760 480 860 L520 900 H-40Z" fill="#0a3a86" opacity=".7" />
          <circle cx="620" cy="90" r="190" fill="#0f55b3" opacity=".35" /><circle cx="40" cy="330" r="150" fill="#0f55b3" opacity=".22" />
        </svg>
        <div className="lg-side-in">
          <Link to="/" className="lg-logo" aria-label="TradeLink home"><img src="/brand/logo-full-light.png" width="460" height="114" alt="TradeLink — Wholesale and retail in one place" /></Link>
          <h1 className="lg-hello">{t.welcome} <span>{t.back}</span></h1>
          <p className="lg-tag">{t.tagline}</p>
          <p className="lg-lead">{t.lead}</p>
          <LoginHero />
          <ul className="lg-trust">
            <li><span><Handshake size={26} /></span>{t.trust1}</li>
            <li><span><ShieldCheck size={26} /></span>{t.trust2}</li>
            <li><span><TrendingUp size={26} /></span>{t.trust3}</li>
          </ul>
        </div>
      </aside>

      <main className="lg-main">
        <LangMenu lang={lang} setLang={setLang} label={t.lang} />
        <div className="lg-card">
          <div className="lg-tabs" role="tablist">
            <span role="tab" aria-selected="true" className="on"><User size={22} />{t.tabIn}</span>
            <Link to="/supplier/register" role="tab" aria-selected="false"><Store size={22} />{t.tabReg}</Link>
          </div>
          <h2>{t.title}</h2>
          <p className="lg-sub">{t.sub}</p>
          {!isSupabaseConfigured && <div className="setup-warning">{t.notConfigured}</div>}
          <form onSubmit={login} noValidate={false}>
            <label className="lg-field"><Mail size={22} aria-hidden="true" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder={t.email} aria-label={t.email} autoComplete="username" /></label>
            <label className="lg-field"><Lock size={22} aria-hidden="true" />
              <input type={show ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required placeholder={t.password} aria-label={t.password} autoComplete="current-password" />
              <button type="button" className="lg-eye" onClick={() => setShow(s => !s)} aria-label={show ? t.hide : t.show} aria-pressed={show}>{show ? <Eye size={22} /> : <EyeOff size={22} />}</button></label>
            {error && <p className="lg-msg lg-err" role="alert">{error}</p>}
            {info && <p className="lg-msg lg-ok" role="status">{info}</p>}
            <button className="lg-submit" disabled={busy || !isSupabaseConfigured}><LogIn size={22} />{busy ? t.busy : t.submit}</button>
            <div className="lg-row">
              <label className="lg-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /><i aria-hidden="true"><Check size={14} strokeWidth={3.5} /></i>{t.remember}</label>
              <button type="button" className="lg-link" onClick={() => void forgot()} disabled={!isSupabaseConfigured}>{t.forgot}</button>
            </div>
          </form>
          <div className="lg-or"><span>{t.or}</span></div>
          <button type="button" className="lg-outline" onClick={() => navigate("/supplier/register")}><UserPlus size={22} />{t.register}</button>
          <Link to="/" className="lg-back"><ArrowLeft size={22} />{t.home}</Link>
        </div>
        <p className="lg-foot"><i />{t.foot}<i /></p>
      </main>

    </div>
  );
}
