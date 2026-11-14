import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!loading && session) navigate("/admin", { replace: true }); }, [loading, session, navigate]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { error: authError } = await requireSupabase().auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally { setBusy(false); }
  };

  return (
    <div className="login-screen"><div className="login-card">
      <Brand />
      <div className="login-heading"><h1>Admin & Staff Login</h1><p>Sign in to your TradeLink workspace.</p></div>
      {!isSupabaseConfigured && <div className="setup-warning">Supabase is not configured yet. Add your environment variables before signing in.</div>}
      <form onSubmit={login}>
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Your password" autoComplete="current-password" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn green wide" disabled={busy || !isSupabaseConfigured}>{busy ? "Signing in…" : "Sign in securely"}</button>
      </form>
      <button className="back-public" onClick={() => navigate("/")}>← Return to public website</button>
    </div></div>
  );
}
