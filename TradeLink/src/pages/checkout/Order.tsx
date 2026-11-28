import DriverTracker from "./DriverTracker";
import OrderCode from "./OrderCode";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Copy, FileUp, Loader2, Printer, Search, Truck } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { METHOD_LABEL, isTransfer, loadIdentity, myOrders, submitProof, trackOrder, uploadProof, type OrderView } from "../../lib/checkout";
import { CoShell, StatusBanner, StatusPill, etb, when } from "./parts";

const phoneKey = (n: string) => `tl-order-phone-${n}`;
const readPhone = (n: string) => { try { return sessionStorage.getItem(phoneKey(n)) || loadIdentity()?.phone || ""; } catch { return loadIdentity()?.phone ?? ""; } };

function Copy1({ text, label }: { text: string; label: string }) {
  const [ok, setOk] = useState(false);
  return <button type="button" className="co-copy" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setOk(true); window.setTimeout(() => setOk(false), 1500); }); }}>{ok ? <Check size={15} /> : <Copy size={15} />}</button>;
}

export default function Order() {
  const { number = "" } = useParams();
  const { session, loading: authLoading } = useAuth();
  const [order, setOrder] = useState<OrderView | null>(null);
  const [phone, setPhone] = useState(() => readPhone(number));
  const [state, setState] = useState<"loading" | "ask" | "ready">("loading");
  const [error, setError] = useState("");
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  // Only the signed-in person matters, not the session object: it is replaced on every silent token refresh (for example when the
  // phone returns from the file picker), and reloading then would blank the page and lose the chosen receipt.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const userId = session?.user?.id ?? "";

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState("loading");
    try {
      let o: OrderView | undefined;
      if (phoneRef.current) o = await trackOrder(number, phoneRef.current);
      else if (sessionRef.current) o = (await myOrders()).find(x => x.order_number === number);
      if (o) { setOrder(o); setState("ready"); setError(""); } else if (!quiet) setState("ask");
    } catch (e) {
      if (!quiet) { setState("ask"); if (phoneRef.current) setError(e instanceof Error ? e.message : "We could not find that order."); }
    }
  }, [number]);

  useEffect(() => { if (!authLoading) void load(); }, [authLoading, load, userId]);
  // While we wait for the bank or the delivery, the page refreshes itself so the customer sees the confirmation.
  const waiting = order?.payment && ["pending", "submitted", "processing"].includes(order.payment.status);
  useEffect(() => { if (!waiting) return; const t = window.setInterval(() => void load(true), 30000); return () => window.clearInterval(t); }, [waiting, load]);

  const ask = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const p = String(new FormData(e.currentTarget).get("phone") ?? "");
    try { sessionStorage.setItem(phoneKey(number), p); } catch { /* storage unavailable */ }
    setPhone(p); phoneRef.current = p; void load();
  };

  if (state === "loading") return <CoShell><p className="co-note"><Loader2 className="co-spin" /> Loading your order…</p></CoShell>;
  if (state === "ask" || !order) return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-empty">
        <Search /><h1>Find your order</h1>
        <p>Enter the phone number you used for order <b>{number}</b>.</p>
        <form className="co-find" onSubmit={ask}>
          <label>Phone<input name="phone" type="tel" inputMode="tel" required maxLength={20} placeholder="+251 …" autoComplete="tel" /></label>
          {error && <p className="co-err" role="alert">{error}</p>}
          <button className="btn green" type="submit">Show my order</button>
        </form>
      </div>
    </CoShell>
  );

  const p = order.payment;
  return (
    <CoShell back={{ to: "/account", label: "My orders" }}>
      <h1 className="co-h1">Order {order.order_number}</h1>
      {p && <StatusBanner payment={p} />}

      {p?.bank && isTransfer(p.method) && ["pending", "failed"].includes(p.status) && <BankCard order={order} />}
      {p && isTransfer(p.method) && ["pending", "submitted", "failed"].includes(p.status) && order.status !== "cancelled" && (
        <ProofForm order={order} phone={phone} onDone={o => setOrder(o)} />
      )}

      <section className="co-card">
        <h2>Payment</h2>
        {p ? <dl className="co-facts">
          <div><dt>Status</dt><dd><StatusPill status={p.status} /></dd></div>
          <div><dt>Method</dt><dd>{METHOD_LABEL[p.method]}</dd></div>
          <div><dt>Amount</dt><dd><b>{etb(p.amount)}</b></dd></div>
          <div><dt>Payment reference</dt><dd className="mono">{p.reference} <Copy1 text={p.reference} label="payment reference" /></dd></div>
          {p.customer_txn_ref && <div><dt>Your transfer reference</dt><dd className="mono">{p.customer_txn_ref}</dd></div>}
          {p.paid_at && <div><dt>Paid on</dt><dd>{when(p.paid_at)}</dd></div>}
        </dl> : <p className="co-note">No payment is recorded for this order yet.</p>}
        {order.payments.length > 1 && (
          <details className="co-hist"><summary>Earlier payment attempts ({order.payments.length - 1})</summary>
            {order.payments.slice(1).map(x => <p key={x.reference}><span className="mono">{x.reference}</span> · {METHOD_LABEL[x.method]} · {etb(x.amount)} · <StatusPill status={x.status} /></p>)}
          </details>)}
      </section>

      <section className="co-card">
        <h2>Order</h2>
        {order.items.map(i => <div className="co-rline" key={i.name}><span>{i.name} <small>× {i.quantity} {i.unit}</small></span><b>{etb(i.line_total)}</b></div>)}
        <div className="co-rline"><span>Delivery</span><b>{Number(order.delivery_fee) > 0 ? etb(order.delivery_fee) : "Free"}</b></div>
        <div className="co-rline sum"><span>Total</span><b>{etb(order.total)}</b></div>
        <p className="co-note"><Truck size={15} /> Delivery to {order.delivery_location} · <b>{order.delivery_status ? order.delivery_status.replace(/_/g, " ") : order.status === "cancelled" ? "cancelled" : "not dispatched yet"}</b></p>
      </section>

      {order.status !== "cancelled" && <OrderCode number={order.order_number} phone={phone} deliveryStatus={order.delivery_status} />}
      {order.delivery_status && phone && <DriverTracker number={order.order_number} phone={phone} />}

      {p?.status === "paid" && <button type="button" className="btn outline co-print" onClick={() => window.print()}><Printer size={16} /> Download receipt</button>}
      {p?.status === "paid" && <Receipt order={order} />}
      <p className="co-note">Questions? Quote your order number <b>{order.order_number}</b>. <Link to="/">Continue shopping</Link></p>
    </CoShell>
  );
}

function BankCard({ order }: { order: OrderView }) {
  const b = order.payment!.bank!;
  const rows: [string, string][] = [["Pay to", b.bank_name], ["Account name", b.account_name], ["Account number", b.account_number], ["Amount to send", etb(order.payment!.amount)], ["Put this in the payment note", order.payment!.reference]];
  return (
    <section className="co-card co-bank">
      <h2>Send the payment</h2>
      <dl className="co-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="mono">{v} <Copy1 text={k === "Amount to send" ? String(order.payment!.amount) : v} label={k} /></dd></div>)}</dl>
      {b.note && <p className="co-note">{b.note}</p>}
      <p className="co-note">Your order is not paid until we see the money in our account.</p>
    </section>
  );
}

function ProofForm({ order, phone, onDone }: { order: OrderView; phone: string; onDone: (o: OrderView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); if (busy) return;
    const txn = String(new FormData(e.currentTarget).get("txn") ?? "").trim();
    setBusy(true); setError("");
    try {
      if (!file) throw new Error("Attach your payment receipt (photo, screenshot or PDF).");
      const stored = await uploadProof(file, order.order_number, phone);
      onDone(await submitProof(order.order_number, phone, txn, stored));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not send your details."); }
    setBusy(false);
  };
  const again = order.payment!.status !== "pending";
  return (
    <section className="co-card">
      <h2>{again ? "Send the details again" : "I have sent the payment"}</h2>
      <p className="co-note">Attach a photo or screenshot of your payment receipt (bank, Telebirr or eBirr). The transaction number is optional. We always check that the money arrived.</p>
      <form className="co-fields" onSubmit={submit}>
        <label className="wide">Transaction reference <small>(optional)</small><input name="txn" maxLength={40} autoComplete="off" placeholder="e.g. FT26323ABC12" /></label>
        <label className="wide co-file"><span><FileUp size={16} /> Payment receipt <small>(required: photo, screenshot or PDF)</small></span><input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} />{file && <em className="co-fname">{file.name} · {(file.size / 1048576).toFixed(1)} MB</em>}</label>
        {error && <p className="co-err wide" role="alert">{error}</p>}
        <button className="btn green wide" type="submit" disabled={busy}>{busy ? "Sending…" : "Send payment details"}</button>
      </form>
    </section>
  );
}

/** Printed only: the page's print stylesheet hides everything else. */
function Receipt({ order }: { order: OrderView }) {
  const p = order.payment!;
  return (
    <section className="co-receipt" aria-hidden="true">
      <h2>TradeLink — Payment receipt</h2>
      <p>Order {order.order_number} · {order.customer_name}</p>
      <table><tbody>
        {order.items.map(i => <tr key={i.name}><td>{i.name} × {i.quantity} {i.unit}</td><td>{etb(i.line_total)}</td></tr>)}
        <tr><td>Delivery</td><td>{Number(order.delivery_fee) > 0 ? etb(order.delivery_fee) : "Free"}</td></tr>
        <tr><th>Total paid</th><th>{etb(p.amount)}</th></tr>
      </tbody></table>
      <p>Method: {METHOD_LABEL[p.method]}<br />Payment reference: {p.reference}{p.customer_txn_ref ? <><br />Transfer reference: {p.customer_txn_ref}</> : null}<br />Paid on: {when(p.paid_at)}</p>
    </section>
  );
}
