import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { useAuth } from "../lib/auth";
import { requireSupabase } from "../lib/supabase";

/** Where invited staff (and people resetting a forgotten password) choose their password. */
export default function SetPassword() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Use at least 8 characters."); return; }
    if (password !== again) { setError("The two passwords do not match."); return; }
    setBusy(true);
    try {
      const { error: err } = await requireSupabase().auth.updateUser({ password });
      if (err) throw err;
      navigate("/admin", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the password");
    } finally { setBusy(false); }
  };

  return (
    <div className="login-screen"><div className="login-card">
      <Brand />
      {loading
        ? <div className="login-heading"><p>Checking your link…</p></div>
        : !session
          ? <>
              <div className="login-heading"><h1>This link has expired</h1><p>Invitation and reset links work once. Ask your manager to send a new invitation, or use “Forgot password” on the login page.</p></div>
              <button className="btn green wide" onClick={() => navigate("/login")}>Go to login</button>
            </>
          : <>
              <div className="login-heading"><h1>Choose your password</h1><p>You will use it, with {session.user.email}, to sign in to TradeLink.</p></div>
              <form onSubmit={submit}>
                <label>New password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
                <label>Repeat password<input type="password" value={again} onChange={e => setAgain(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
                {error && <p className="form-error" role="alert">{error}</p>}
                <button className="btn green wide" disabled={busy}>{busy ? "Saving…" : "Save password and continue"}</button>
              </form>
            </>}
    </div></div>
  );
}
