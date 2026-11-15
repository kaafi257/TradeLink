import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { Brand } from "./components/Brand";
import { AuthProvider, useAuth } from "./lib/auth";
import { arrivedFromEmailLink } from "./lib/supabase";
import PublicHome from "./pages/PublicHome";
import Login from "./pages/Login";
import SetPassword from "./pages/SetPassword";

// The admin workspace (and its charts) is only downloaded by people who sign in.
const AdminLayout = lazy(() => import("./admin/AdminLayout"));

/** Invite and reset emails land on the site root; send those visitors to choose a password first. */
function EmailLinkGate() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const done = useRef(false);
  useEffect(() => {
    if (arrivedFromEmailLink && !loading && session && !done.current) { done.current = true; navigate("/set-password", { replace: true }); }
  }, [loading, session, navigate]);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <EmailLinkGate />
      <Suspense fallback={<div className="loading-screen"><Brand /><p>Loading TradeLink…</p></div>}>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/set-password" element={<SetPassword />} />
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
