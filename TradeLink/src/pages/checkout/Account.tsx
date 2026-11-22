import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, LogOut, Phone, Receipt, ShoppingBag, UserRound } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import { METHOD_LABEL, clearIdentity, loadIdentity, myOrders, ordersByContact, saveIdentity, type Identity, type OrderView } from "../../lib/checkout";
import { CoShell, StatusPill, etb, when } from "./parts";

export default function Account() {
  const { session, loading, signOut } = useAuth();
  const [who, setWho] = useState<Identity | null>(() => loadIdentity());
  if (loading) return <CoShell><p className="co-note">Loading…</p></CoShell>;
  if (session) return <History title={String((session.user.user_metadata as { full_name?: string })?.full_name ?? session.user.email ?? "")} load={myOrders} onOut={async () => { await signOut(); }} />;
  if (who) return <History title={who.name} sub={who.phone} load={() => ordersByContact(who.name, who.phone)} onOut={async () => { clearIdentity(); setWho(null); }} />;
  return <SignIn onContact={i => { saveIdentity(i); setWho(i); }} />;
}

function SignIn({ onContact }: { onContact: (i: Identity) => void }) {
  const [mode, setMode] = useState<"phone" | "in" | "up">("phone");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    if (mode === "phone") {
      const name = String(f.get("name") ?? "").trim(), phone = String(f.get("phone") ?? "").trim();
      setBusy(true); setError("");
      try {
        const rows = await ordersByContact(name, phone);
        if (!rows.length) throw new Error("No orders found with that name and phone number. Use exactly the name and phone you gave when you ordered.");
        onContact({ name, phone });
      } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); setBusy(false); }
      return;
    }
    if (!supabase) return;
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
  const go = (m: typeof mode) => { setMode(m); setError(""); };
  return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-auth co-card">
        <UserRound className="co-auth-ic" />
        <h1>My orders</h1>
        <p className="co-note">{mode === "phone" ? "Enter the name and phone number you ordered with. You will see your orders and what is still waiting for payment." : mode === "in" ? "Sign in to your account." : "An account keeps your orders in one place."}</p>
        <div className="co-seg three" role="tablist">
          <button role="tab" aria-selected={mode === "phone"} className={mode === "phone" ? "on" : ""} onClick={() => go("phone")}><Phone size={14} /> Phone</button>
          <button role="tab" aria-selected={mode === "in"} className={mode === "in" ? "on" : ""} onClick={() => go("in")}>Email</button>
          <button role="tab" aria-selected={mode === "up"} className={mode === "up" ? "on" : ""} onClick={() => go("up")}>New account</button>
        </div>
        <form className="co-fields" onSubmit={submit} key={mode}>
          {mode === "phone" && <>
            <label className="wide">Full name<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label>
            <label className="wide">Phone number<input name="phone" type="tel" inputMode="tel" required maxLength={20} autoComplete="tel" placeholder="+251 …" /></label>
          </>}
          {mode === "up" && <><label className="wide">Full name<input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label><label className="wide">Phone <small>(optional)</small><input name="phone" type="tel" maxLength={30} autoComplete="tel" /></label></>}
          {mode !== "phone" && <>
            <label className="wide">Email<input name="email" type="email" required maxLength={160} autoComplete="email" /></label>
            <label className="wide">Password<input name="password" type="password" required minLength={mode === "up" ? 8 : 1} maxLength={72} autoComplete={mode === "up" ? "new-password" : "current-password"} /></label>
            <div className="honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
          </>}
          {error && <p className="co-err wide" role="alert">{error}</p>}
          <button className="btn green wide" type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "phone" ? "Show my orders" : mode === "in" ? "Sign in" : "Create account"}</button>
        </form>
      </div>
    </CoShell>
  );
}

const unpaid = (o: OrderView) => !!o.payment && ["pending", "submitted", "failed"].includes(o.payment.status) && o.status !== "cancelled";

function History({ title, sub, load, onOut }: { title: string; sub?: string; load: () => Promise<OrderView[]>; onOut: () => Promise<void> }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<OrderView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const run = () => load().then(r => { if (live) setRows(r); }).catch(e => { if (live) setError(e instanceof Error ? e.message : "Could not load your orders."); });
    void run();
    const t = window.setInterval(() => void run(), 30000); // the status updates by itself when we confirm a payment
    return () => { live = false; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const waiting = (rows ?? []).filter(unpaid);
  const pays = (rows ?? []).flatMap(o => o.payments.map(p => ({ o, p })));
  return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-acct-head"><div><h1 className="co-h1">My orders</h1><p className="co-note">{title}{sub ? ` · ${sub}` : ""}</p></div>
        <button className="btn outline" onClick={() => void onOut().then(() => navigate("/account"))}><LogOut size={16} /> Not me</button></div>
      {error && <p className="co-err" role="alert">{error}</p>}
      {waiting.length > 0 && (
        <section className="co-card co-wait" aria-label="Waiting for payment">
          <h2><AlertCircle size={18} /> Waiting for payment</h2>
          {waiting.map(o => (
            <Link className="co-hrow" key={o.order_number} to={`/order/${o.order_number}`}>
              <div><b className="mono">{o.order_number}</b><small>{when(o.created_at)}</small></div>
              <div><span>{METHOD_LABEL[o.payment!.method]}</span><small>{o.payment!.status === "submitted" ? "We are checking your payment" : o.payment!.method === "cod" ? "Pay the delivery person" : "Open to pay and send your receipt"}</small></div>
              <div className="end"><b>{etb(o.payment!.amount)}</b><StatusPill status={o.payment!.status} /></div>
            </Link>))}
        </section>)}
      {rows && !pays.length && <div className="co-empty"><ShoppingBag /><h2>No orders yet</h2><p>Your orders and payments will appear here.</p><Link className="btn green" to="/">Start shopping</Link></div>}
      {pays.length > 0 && <h2 className="co-sech">All payments</h2>}
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
