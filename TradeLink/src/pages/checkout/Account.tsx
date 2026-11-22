import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Receipt, ShoppingBag, UserRound } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { METHOD_LABEL, myOrders, type OrderView } from "../../lib/checkout";
import { CoShell, StatusPill, etb, when } from "./parts";

export default function Account() {
  const { session, loading, signOut } = useAuth();
  if (loading) return <CoShell><p className="co-note">Loading…</p></CoShell>;
  return session ? <History onOut={signOut} name={String((session.user.user_metadata as { full_name?: string })?.full_name ?? session.user.email ?? "")} /> : <SignIn />;
}

function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supabase || busy) return;
    const f = new FormData(e.currentTarget);
    const email = String(f.get("email") ?? "").trim(), password = String(f.get("password") ?? "");
    setBusy(true); setError("");
    try {
      if (mode === "up") {
        const r = await supabase.functions.invoke("customer-signup", { body: { email, password, full_name: f.get("name"), phone: f.get("phone"), website: f.get("website") } });
        if (r.error) {
          let msg = "We could not create the account. Please try again.";
          try { const b = await (r.error as { context?: Response }).context?.json(); if (b?.error) msg = b.error; } catch { /* keep generic */ }
          throw new Error(msg);
        }
        if (r.data?.error) throw new Error(String(r.data.error));
      }
      const { error: e2 } = await supabase.auth.signInWithPassword({ email, password });
      if (e2) throw new Error("Wrong email or password.");
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); setBusy(false); }
  };
  return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-auth co-card">
        <UserRound className="co-auth-ic" />
        <h1>{mode === "in" ? "Sign in" : "Create your account"}</h1>
        <p className="co-note">An account keeps your orders and payments in one place. You can also order without one.</p>
        <div className="co-seg" role="tablist"><button role="tab" aria-selected={mode === "in"} className={mode === "in" ? "on" : ""} onClick={() => { setMode("in"); setError(""); }}>Sign in</button><button role="tab" aria-selected={mode === "up"} className={mode === "up" ? "on" : ""} onClick={() => { setMode("up"); setError(""); }}>Create account</button></div>
        <form className="co-fields" onSubmit={submit}>
          {mode === "up" && <><label className="wide">Full name<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label><label className="wide">Phone <small>(optional)</small><input name="phone" type="tel" maxLength={30} autoComplete="tel" /></label></>}
          <label className="wide">Email<input name="email" type="email" required maxLength={160} autoComplete="email" /></label>
          <label className="wide">Password<input name="password" type="password" required minLength={mode === "up" ? 8 : 1} maxLength={72} autoComplete={mode === "up" ? "new-password" : "current-password"} /></label>
          <div className="honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          {error && <p className="co-err wide" role="alert">{error}</p>}
          <button className="btn green wide" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</button>
        </form>
      </div>
    </CoShell>
  );
}

function History({ name, onOut }: { name: string; onOut: () => Promise<void> }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OrderView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { myOrders().then(setRows).catch(e => setError(e instanceof Error ? e.message : "Could not load your orders.")); }, []);
  const pays = (rows ?? []).flatMap(o => o.payments.map(p => ({ o, p })));
  return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-acct-head"><div><h1 className="co-h1">My payments</h1><p className="co-note">{name}</p></div>
        <button className="btn outline" onClick={() => void onOut().then(() => navigate("/"))}><LogOut size={16} /> Sign out</button></div>
      {error && <p className="co-err" role="alert">{error}</p>}
      {rows && !pays.length && <div className="co-empty"><ShoppingBag /><h2>No orders yet</h2><p>Your payments will appear here after you place an order while signed in.</p><Link className="btn green" to="/">Start shopping</Link></div>}
      <div className="co-hlist">
        {pays.map(({ o, p }) => (
          <Link className="co-hrow" key={p.reference} to={`/order/${o.order_number}`}>
            <div><b className="mono">{o.order_number}</b><small>{when(p.paid_at ?? p.created_at)}</small></div>
            <div><span>{METHOD_LABEL[p.method]}</span><small className="mono">{p.reference}</small></div>
            <div className="end"><b>{etb(p.amount)}</b><StatusPill status={p.status} /></div>
            {p.status === "paid" && <span className="co-rcpt"><Receipt size={15} /> Receipt</span>}
          </Link>
        ))}
      </div>
    </CoShell>
  );
}
