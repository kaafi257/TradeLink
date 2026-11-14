import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Brand } from "./components/Brand";
import { AuthProvider } from "./lib/auth";
import PublicHome from "./pages/PublicHome";
import Login from "./pages/Login";

// The admin workspace (and its charts) is only downloaded by people who sign in.
const AdminLayout = lazy(() => import("./admin/AdminLayout"));

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<div className="loading-screen"><Brand /><p>Loading TradeLink…</p></div>}>
        <Routes>
          <Route path="/" element={<PublicHome />} />
          <Route path="/login" element={<Login />} />
          <Route path="/admin/*" element={<AdminLayout />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AuthProvider>
  );
}
