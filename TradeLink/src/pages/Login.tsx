import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { isSupabaseConfigured, requireSupabase } from "../lib/supabase";

export default function Login() {
  const navigate = useNavigate();
  const { session, loading, profile } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  useEffect(() => { if (!loading && session) navigate(profile?.role === "supplier" ? "/supplier" : "/admin", { replace: true }); }, [loading, session, profile, navigate]);

  const login = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const { error: authError } = await requireSupabase().auth.signInWithPassword({ email, password });
      if (authError) throw authError;
      void Promise.resolve(requireSupabase().rpc("log_login")).catch(() => {}); // sign-in history for the audit report
      // The effect above sends the user to the right place once their profile has loaded.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally { setBusy(false); }
  };

  const forgot = async () => {
    setError(""); setInfo("");
    if (!email.trim()) { setError("Enter your email address above first."); return; }
    try {
      const { error: resetError } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/set-password` });
      if (resetError) throw resetError;
      setInfo("If that email belongs to an account, a reset link is on its way.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send the reset email"); }
  };

  return (
    <div className="login-screen"><div className="login-card">
      <Brand />
      <div className="login-heading"><h1>Sign in</h1><p>Staff and suppliers: sign in to your TradeLink workspace.</p></div>
      {!isSupabaseConfigured && <div className="setup-warning">Supabase is not configured yet. Add your environment variables before signing in.</div>}
      <form onSubmit={login}>
        <label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@company.com" autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Your password" autoComplete="current-password" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {info && <p className="inline-note" role="status">{info}</p>}
        <button className="btn green wide" disabled={busy || !isSupabaseConfigured}>{busy ? "Signing in…" : "Sign in securely"}</button>
      </form>
      <button type="button" className="back-public" onClick={() => void forgot()} disabled={!isSupabaseConfigured}>Forgot password?</button>
      <button className="back-public" onClick={() => navigate("/supplier/register")}>New supplier? Register your business</button>
      <button className="back-public" onClick={() => navigate("/")}>← Return to public website</button>
    </div></div>
  );
}
