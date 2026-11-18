import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Bell, Check, LogOut, Menu, Search } from "lucide-react";
import { Brand } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { supabase, type Role } from "../lib/supabase";
import "./admin.css";
import { AdminDataProvider, useAdmin } from "./AdminData";
import { NAV, allowed } from "./nav";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Quotations from "./pages/Quotations";
import SalesPage from "./pages/Sales";
import Orders from "./pages/Orders";
import Deliveries from "./pages/Deliveries";
import Staff from "./pages/Staff";
import Inventory from "./pages/Inventory";
const Reports = lazy(() => import("./pages/Reports"));
import Customers from "./pages/Customers";
import Categories from "./pages/Categories";
import Suppliers from "./pages/Suppliers";
import Communication from "./pages/Communication";
import ActivityLog from "./pages/ActivityLog";
import SettingsPage from "./pages/Settings";

function Screen({ title, text, children }: { title: string; text: string; children?: ReactNode }) {
  return (
    <div className="login-screen"><div className="login-card">
      <Brand /><div className="login-heading"><h1>{title}</h1><p>{text}</p></div>{children}
    </div></div>
  );
}

function Guard({ role, roles, children }: { role: Role; roles: Role[]; children: ReactNode }) {
  return roles.includes(role) ? <>{children}</> : <Navigate to="/admin" replace />;
}

function Shell() {
  const { profile, search, setSearch, newQuoteCount, notice } = useAdmin();
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const role = profile.role;
  const current = NAV.find(n => (n.end ? pathname === n.path : pathname.startsWith(n.path)));
  const displayName = profile.full_name || profile.email;

  // A new page closes the drawer and the phone search row.
  useEffect(() => { setMobileNav(false); setSearchOpen(false); }, [pathname]);
  // Escape closes the drawer.
  useEffect(() => {
    if (!mobileNav) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileNav(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNav]);
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);

  const g = (roles: Role[], el: ReactNode) => <Guard role={role} roles={roles}>{el}</Guard>;

  return (
    <div className="admin-layout">
      <aside id="admin-sidebar" className={`sidebar ${mobileNav ? "show" : ""}`}>
        <div className="sidebar-brand"><Brand light /></div>
        <nav className="side-nav" aria-label="Admin navigation">
          {NAV.filter(item => allowed(item, role)).map(item => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} end={item.end} className={({ isActive }) => (isActive ? "selected" : "")} onClick={() => setMobileNav(false)}>
                <Icon size={18} /><span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          <div><b>{displayName}</b><small>{role}</small></div>
        </div>
        <button className="logout-button" onClick={() => void signOut().then(() => navigate("/"))}><LogOut size={18} /> Log out</button>
      </aside>

      <div className="admin-main">
        <button className={`scrim ${mobileNav ? "on" : ""}`} aria-label="Close menu" onClick={() => setMobileNav(false)} />
        <header className={`admin-topbar${searchOpen ? " search-open" : ""}`}>
          <button className="mobile-menu" aria-label="Toggle menu" aria-controls="admin-sidebar" aria-expanded={mobileNav} onClick={() => setMobileNav(!mobileNav)}><Menu /></button>
          <h2 className="topbar-title">{current?.label ?? "Dashboard"}</h2>
          <div className="global-search"><Search size={19} /><input ref={searchRef} aria-label="Search this page" placeholder="Search this page…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="top-actions">
            <button className="mobile-search" aria-label="Search this page" aria-expanded={searchOpen} onClick={() => setSearchOpen(o => !o)}><Search size={19} /></button>
            {["owner", "manager", "sales"].includes(role) && (
              <button className="notification-button" title="New quote requests" aria-label={`${newQuoteCount} new quote requests`} onClick={() => navigate("/admin/quotations")}>
                <Bell />{newQuoteCount > 0 && <i>{newQuoteCount > 99 ? "99+" : newQuoteCount}</i>}
              </button>
            )}
            <div className="user-menu">
              <div className="avatar">{(displayName || "A").slice(0, 1).toUpperCase()}</div>
              <div><b>{displayName}</b><small>{role}</small></div>
            </div>
          </div>
        </header>

        <main className="admin-content dash-glass">
          <Suspense fallback={null}><Routes>
            <Route index element={<Dashboard />} />
            <Route path="products" element={g(["owner", "manager", "sales", "inventory", "delivery"], <Products />)} />
            <Route path="categories" element={g(["owner", "manager", "inventory"], <Categories />)} />
            <Route path="suppliers" element={g(["owner", "manager", "inventory"], <Suppliers />)} />
            <Route path="quotations" element={g(["owner", "manager", "sales"], <Quotations />)} />
            <Route path="orders" element={g(["owner", "manager", "sales"], <Orders />)} />
            <Route path="deliveries" element={g(["owner", "manager", "sales", "delivery"], <Deliveries />)} />
            <Route path="sales" element={g(["owner", "manager", "sales"], <SalesPage />)} />
            <Route path="staff" element={g(["owner", "manager"], <Staff />)} />
            <Route path="inventory" element={g(["owner", "manager", "inventory"], <Inventory />)} />
            <Route path="reports" element={g(["owner", "manager"], <Reports />)} />
            <Route path="communication" element={g(["owner", "manager", "sales"], <Communication />)} />
            <Route path="customers" element={g(["owner", "manager", "sales"], <Customers />)} />
            <Route path="activity" element={g(["owner", "manager"], <ActivityLog />)} />
            <Route path="settings" element={g(["owner", "manager"], <SettingsPage />)} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes></Suspense>
        </main>
        <footer className="admin-footer"><small>© {new Date().getFullYear()} TradeLink Food Wholesale</small></footer>
      </div>
      {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    </div>
  );
}

/** Signing in is not enough: the user must also have an active staff profile. */
export default function AdminLayout() {
  const { loading, session, profile, profileError, signOut } = useAuth();
  if (loading) return <div className="loading-screen"><Brand /><p>Loading TradeLink…</p></div>;
  if (!supabase || !session) return <Navigate to="/login" replace />;
  if (profile?.role === "supplier") return <Navigate to="/supplier" replace />;   // suppliers have their own portal
  if (!profile || !profile.active) {
    return (
      <Screen title="No access yet" text="Your account is signed in, but it has not been activated for the TradeLink workspace. Ask the owner to give you access.">
        {profileError && <p className="form-error" role="alert">Technical detail: {profileError}</p>}
        <button className="btn green wide" onClick={() => void signOut()}>Sign out</button>
      </Screen>
    );
  }
  return <AdminDataProvider profile={profile}><Shell /></AdminDataProvider>;
}
