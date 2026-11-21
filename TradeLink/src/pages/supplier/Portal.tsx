import { useEffect, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { BadgeCheck, Bell, Boxes, Building2, CheckCircle2, CircleDashed, ClipboardList, Clock, Megaphone, Home, LayoutDashboard, LogOut, Menu, Package, PauseCircle, X, XCircle } from "lucide-react";
import { Brand } from "../../components/Brand";
import { useAuth } from "../../lib/auth";
import { IconFor } from "../../lib/icons";
import { errorText, requireSupabase, supabase, type PublicIndustry, type SupplierStatus } from "../../lib/supabase";
import { BUSINESS_TYPES } from "./Register";
import { SupplierProvider, useSupplier } from "./context";
import { logoUrl } from "./files";
import Profile from "./Profile";
import Dashboard from "./Dashboard";
import Products from "./Products";
import Inventory from "./Inventory";
import Orders from "./Orders";
import Promotions from "./Promotions";
import "./supplier.css";

export const STATUS: Record<SupplierStatus, { label: string; tone: "wait" | "good" | "bad" | "hold"; Icon: typeof Clock }> = {
  pending: { label: "Pending approval", tone: "wait", Icon: Clock },
  approved: { label: "Approved", tone: "good", Icon: BadgeCheck },
  rejected: { label: "Needs changes", tone: "bad", Icon: XCircle },
  suspended: { label: "Suspended", tone: "hold", Icon: PauseCircle },
};
export const StatusPill = ({ status }: { status: SupplierStatus }) => {
  const s = STATUS[status];
  return <span className={`sp-pill ${s.tone}`}><s.Icon size={13} /> {s.label}</span>;
};
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

function Screen({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="sp sp-auth"><div className="sp-auth-card sp-done"><Brand /><h1>{title}</h1><p>{text}</p>{children}</div></div>
  );
}

/* ---------------------------------------------------------------- overview */
function Overview() {
  const { supplier, refresh } = useSupplier();
  const navigate = useNavigate();
  const [industries, setIndustries] = useState<PublicIndustry[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void supabase.from("public_industries").select("*").then(r => { if (!r.error) setIndustries((r.data ?? []) as PublicIndustry[]); });
  }, []);
  if (!supplier) return null;
  const status = supplier.status ?? "pending";
  const ind = industries.find(i => i.id === supplier.industry_id);
  const type = BUSINESS_TYPES.find(t => t.id === supplier.business_type)?.label;
  const logo = logoUrl(supplier.logo_path);
  const resubmit = async () => {
    setBusy(true); setMsg("");
    try { const { error } = await requireSupabase().rpc("resubmit_supplier"); if (error) throw error; await refresh(); }
    catch (e) { setMsg(errorText(e, "Could not resubmit")); } finally { setBusy(false); }
  };
  const todo = [
    { done: !!supplier.logo_path, text: "Add your business logo" },
    { done: (supplier.documents?.length ?? 0) > 0, text: "Upload a business document (licence, tax or ID)" },
    { done: !!supplier.address, text: "Add your street address" },
  ];
  const copy: Record<SupplierStatus, { head: string; text: string }> = {
    pending: { head: "Your application is being reviewed", text: "TradeLink is checking your business details. You will get a notification here as soon as there is a decision." },
    approved: { head: "Your supplier account is active", text: supplier.reviewed_at ? `Approved on ${when(supplier.reviewed_at)}.` : "Your business is approved." },
    rejected: { head: "Your application needs changes", text: "Please update your details below, then send it back for review." },
    suspended: { head: "Your account is suspended", text: "Your business is hidden from the public site while the suspension is in place. Please contact TradeLink." },
  };
  return (
    <div className="sp-grid">
      <section className={`sp-card sp-status ${STATUS[status].tone}`}>
        <span className="sp-status-ico">{(() => { const I = STATUS[status].Icon; return <I size={26} />; })()}</span>
        <div>
          <StatusPill status={status} />
          <h2>{copy[status].head}</h2>
          <p>{copy[status].text}</p>
          {(status === "rejected" || status === "suspended") && supplier.status_note && <blockquote><b>Message from TradeLink</b>{supplier.status_note}</blockquote>}
          {status === "rejected" && (
            <div className="sp-actions">
              <button className="sp-btn line" onClick={() => navigate("/supplier/profile")}>Edit my details</button>
              <button className="sp-btn primary" disabled={busy} onClick={() => void resubmit()}>{busy ? "Sending…" : "Resubmit for review"}</button>
            </div>
          )}
          {msg && <p className="sp-note err" role="alert">{msg}</p>}
        </div>
      </section>

      <section className="sp-card">
        <h3>Your business</h3>
        <div className="sp-biz">
          <span className="sp-logo">{logo ? <img src={logo} alt="" /> : <Building2 size={24} />}</span>
          <div><b>{supplier.name}</b><small>{ind && <><IconFor name={ind.icon} size={13} /> {ind.name}</>}{type && <> · {type}</>}</small></div>
        </div>
        <dl className="sp-facts">
          <div><dt>Location</dt><dd>{[supplier.location, supplier.address].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt>Owner</dt><dd>{supplier.owner_name || "—"}</dd></div>
          <div><dt>Phone</dt><dd>{supplier.phone || "—"}</dd></div>
          <div><dt>Email</dt><dd>{supplier.email || "—"}</dd></div>
          <div><dt>Registered</dt><dd>{when(supplier.created_at)}</dd></div>
        </dl>
      </section>

      <section className="sp-card">
        <h3>Complete your profile</h3>
        <ul className="sp-todo">{todo.map(t => <li key={t.text} className={t.done ? "done" : ""}>{t.done ? <CheckCircle2 size={17} /> : <CircleDashed size={17} />} {t.text}</li>)}</ul>
        {todo.some(t => !t.done) && <button className="sp-btn line sm" onClick={() => navigate("/supplier/profile")}>Open business profile</button>}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------- notifications */
const ago = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - +new Date(iso)) / 1000));
  if (s < 60) return "just now"; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; return when(iso);
};
function Notifications() {
  const { notifications, unread, markRead } = useSupplier();
  return (
    <section className="sp-card">
      <div className="sp-card-head"><h3>Notifications</h3>{unread > 0 && <button className="sp-link" onClick={() => void markRead()}>Mark all as read</button>}</div>
      {notifications.length === 0 ? <p className="sp-empty"><Bell size={22} /> Nothing yet. Approvals and messages from TradeLink appear here.</p> : (
        <ul className="sp-notes">
          {notifications.map(n => (
            <li key={n.id} className={n.read_at ? "" : "new"}>
              <button onClick={() => void markRead(n.id)}>
                <span className="dot" aria-hidden="true" />
                <span><b>{n.title}</b>{n.body && <small>{n.body}</small>}<em>{ago(n.created_at)}</em></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ shell */
const NAV = [
  { to: "/supplier", end: true, label: "Dashboard", Icon: LayoutDashboard },
  { to: "/supplier/products", end: false, label: "Products", Icon: Package, ops: true },
  { to: "/supplier/inventory", end: false, label: "Inventory", Icon: Boxes, ops: true },
  { to: "/supplier/orders", end: false, label: "Purchase orders", Icon: ClipboardList, ops: true },
  { to: "/supplier/promotions", end: false, label: "Promotions", Icon: Megaphone, ops: true },
  { to: "/supplier/profile", end: false, label: "Business profile", Icon: Building2 },
  { to: "/supplier/notifications", end: false, label: "Notifications", Icon: Bell },
];

function Shell() {
  const { supplier, loading, loadError, unread, notifications, markRead, profile } = useSupplier();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [bell, setBell] = useState(false);
  useEffect(() => { setDrawer(false); setBell(false); }, [pathname]);
  useEffect(() => {
    if (!drawer && !bell) return undefined;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setDrawer(false); setBell(false); } };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); };
  }, [drawer, bell]);

  if (loading) return <div className="loading-screen"><Brand /><p>Loading your portal…</p></div>;
  if (!supplier) {
    return (
      <Screen title="No business found" text={loadError || "Your account is a supplier account, but no business is linked to it. Please contact TradeLink."}>
        <button className="sp-btn primary" onClick={() => void signOut()}>Sign out</button>
      </Screen>
    );
  }
  const title = NAV.find(n => (n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label ?? "Supplier portal";
  return (
    <div className="sp sp-shell">
      {drawer && <button className="sp-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}
      <aside className={`sp-side${drawer ? " open" : ""}`} aria-label="Supplier menu">
        <div className="sp-side-top"><Brand light /><button className="sp-icon sp-close" aria-label="Close menu" onClick={() => setDrawer(false)}><X size={20} /></button></div>
        <nav>
          {NAV.filter(n => !n.ops || supplier.status === "approved").map(({ to, end, label, Icon }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "on" : "")}>
              <Icon size={18} /> {label}{label === "Notifications" && unread > 0 && <i>{unread}</i>}
            </NavLink>
          ))}
        </nav>
        <div className="sp-side-foot">
          <button onClick={() => navigate("/")}><Home size={18} /> TradeLink site</button>
          <button onClick={() => void signOut()}><LogOut size={18} /> Sign out</button>
        </div>
      </aside>
      <div className="sp-main">
        <header className="sp-top">
          <button className="sp-icon sp-burger" aria-label="Open menu" onClick={() => setDrawer(true)}><Menu size={20} /></button>
          <h1>{title}</h1>
          <div className="sp-top-right">
            <StatusPill status={supplier.status ?? "pending"} />
            <div className="sp-bellwrap">
              <button className="sp-icon" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={bell} onClick={() => setBell(b => !b)}><Bell size={19} />{unread > 0 && <i>{unread}</i>}</button>
              {bell && (
                <div className="sp-pop" role="dialog" aria-label="Notifications">
                  <div className="sp-pop-head"><b>Notifications</b>{unread > 0 && <button className="sp-link" onClick={() => void markRead()}>Mark all read</button>}</div>
                  {notifications.length === 0 ? <p className="sp-empty small">No notifications yet</p> : (
                    <ul className="sp-notes">{notifications.slice(0, 6).map(n => (
                      <li key={n.id} className={n.read_at ? "" : "new"}><button onClick={() => { void markRead(n.id); setBell(false); navigate("/supplier/notifications"); }}><span className="dot" aria-hidden="true" /><span><b>{n.title}</b><em>{ago(n.created_at)}</em></span></button></li>
                    ))}</ul>
                  )}
                </div>
              )}
            </div>
            <span className="sp-user" title={profile.email}>{supplier.logo_path ? <img src={logoUrl(supplier.logo_path) ?? ""} alt="" /> : (profile.full_name || profile.email).slice(0, 1).toUpperCase()}</span>
          </div>
        </header>
        <main className="sp-content">
          <Routes>
            <Route index element={supplier.status === "approved" ? <Dashboard /> : <Overview />} />
            {supplier.status === "approved" && <>
              <Route path="products" element={<Products />} />
              <Route path="inventory" element={<Inventory />} />
              <Route path="orders" element={<Orders />} />
              <Route path="promotions" element={<Promotions />} />
            </>}
            <Route path="profile" element={<Profile />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<Navigate to="/supplier" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

/** Signed in AND a supplier account; staff are sent to Admin, visitors to sign in. */
export default function SupplierPortal() {
  const { loading, session, profile, profileError, signOut } = useAuth();
  if (loading) return <div className="loading-screen"><Brand /><p>Loading TradeLink…</p></div>;
  if (!supabase || !session) return <Navigate to="/login" replace />;
  if (profile && profile.role !== "supplier") return <Navigate to="/admin" replace />;
  if (!profile || !profile.active) {
    return (
      <Screen title="No access yet" text="Your account is signed in, but it is not active for the supplier portal. Please contact TradeLink.">
        {profileError && <p className="sp-note err" role="alert">Technical detail: {profileError}</p>}
        <button className="sp-btn primary" onClick={() => void signOut()}>Sign out</button>
      </Screen>
    );
  }
  return <SupplierProvider profile={profile}><Shell /></SupplierProvider>;
}
