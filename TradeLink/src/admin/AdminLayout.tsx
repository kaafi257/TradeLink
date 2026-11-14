import { useState, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { Bell, Check, ChevronDown, ChevronRight, LogOut, Menu, Search } from "lucide-react";
import { Brand } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { supabase, type Role } from "../lib/supabase";
import { AdminDataProvider, useAdmin } from "./AdminData";
import { NAV, allowed } from "./nav";
import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Quotations from "./pages/Quotations";
import SalesPage from "./pages/Sales";
import Staff from "./pages/Staff";
import Inventory from "./pages/Inventory";
import Reports from "./pages/Reports";
import Customers from "./pages/Customers";
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
  const [mobileNav, setMobileNav] = useState(false);
  const role = profile.role;
  const g = (roles: Role[], el: ReactNode) => <Guard role={role} roles={roles}>{el}</Guard>;

  return (
    <div className="admin-layout">
      <aside className={`sidebar ${mobileNav ? "show" : ""}`}>
        <div className="sidebar-brand"><Brand light /></div>
        <nav className="side-nav" aria-label="Admin navigation">
          {NAV.filter(item => allowed(item, role)).map(item => {
            const Icon = item.icon;
            return (
              <NavLink key={item.path} to={item.path} end={item.end} className={({ isActive }) => (isActive ? "selected" : "")} onClick={() => setMobileNav(false)}>
                <Icon size={21} /><span>{item.label}</span><ChevronRight className="nav-chevron" size={16} />
              </NavLink>
            );
          })}
        </nav>
        <button className="logout-button" onClick={() => void signOut().then(() => navigate("/"))}><LogOut size={21} /> Logout</button>
        <div className="sidebar-food" />
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button className="mobile-menu" aria-label="Toggle menu" onClick={() => setMobileNav(!mobileNav)}><Menu /></button>
          <div className="global-search"><Search size={19} /><input aria-label="Search this page" placeholder="Search this page…" value={search} onChange={e => setSearch(e.target.value)} /></div>
          <div className="top-actions">
            {["owner", "manager", "sales"].includes(role) && (
              <button className="notification-button" title="New quote requests" aria-label={`${newQuoteCount} new quote requests`} onClick={() => navigate("/admin/quotations")}>
                <Bell />{newQuoteCount > 0 && <i>{newQuoteCount > 99 ? "99+" : newQuoteCount}</i>}
              </button>
            )}
            <div className="user-menu">
              <div className="avatar">{(profile.full_name || profile.email || "A").slice(0, 1).toUpperCase()}</div>
              <div><b>{profile.full_name || profile.email}</b><small>{role}</small></div>
              <ChevronDown size={17} />
            </div>
          </div>
        </header>

        <main className="admin-content">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="products" element={g(["owner", "manager", "sales", "inventory", "delivery"], <Products />)} />
            <Route path="quotations" element={g(["owner", "manager", "sales"], <Quotations />)} />
            <Route path="sales" element={g(["owner", "manager", "sales", "delivery"], <SalesPage />)} />
            <Route path="staff" element={g(["owner", "manager"], <Staff />)} />
            <Route path="inventory" element={g(["owner", "manager", "inventory"], <Inventory />)} />
            <Route path="reports" element={g(["owner", "manager"], <Reports />)} />
            <Route path="customers" element={g(["owner", "manager", "sales"], <Customers />)} />
            <Route path="activity" element={g(["owner", "manager"], <ActivityLog />)} />
            <Route path="settings" element={g(["owner", "manager"], <SettingsPage />)} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
        </main>
        <footer className="admin-footer"><Brand light /><p>Growing Together. Supplying Better.</p><small>© {new Date().getFullYear()} TradeLink. All rights reserved.</small></footer>
      </div>
      {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}
    </div>
  );
}

/** Signing in is not enough: the user must also have an active staff profile. */
export default function AdminLayout() {
  const { loading, session, profile, signOut } = useAuth();
  if (loading) return <div className="loading-screen"><Brand /><p>Loading TradeLink…</p></div>;
  if (!supabase || !session) return <Navigate to="/login" replace />;
  if (!profile || !profile.active) {
    return (
      <Screen title="No access yet" text="Your account is signed in, but it has not been activated for the TradeLink workspace. Ask the owner to give you access.">
        <button className="btn green wide" onClick={() => void signOut()}>Sign out</button>
      </Screen>
    );
  }
  return <AdminDataProvider profile={profile}><Shell /></AdminDataProvider>;
}
