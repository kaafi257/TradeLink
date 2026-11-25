import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Clock, HandCoins, Inbox, Receipt, ShieldCheck, Undo2, Wallet } from "lucide-react";
import { money } from "../../lib/format";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, Tabs, callRpc, dateOf, dayRange, label, useAction, useLoad } from "../suite";
import CustomerPayments from "./CustomerPayments";
import "./payments.css";
import PayoutReceipt, { type PayoutRec } from "../../components/PayoutReceipt";

type Summary = { received: number; outstanding: number; sales: number; paid_out: number; by_method: { method: string; amount: number }[] };
type Received = { sale_id: string; receipt_number: string; customer_name: string; total_amount: number; amount_paid: number; outstanding: number; payment_method: string | null; sold_at: string };
type Balance = { supplier_id: string; supplier_name: string; earned: number; paid: number; balance: number; verified: boolean; last_paid: string | null };
type Payout = { id: string; amount: number; method: string; reference: string | null; note: string | null; paid_at: string; suppliers: { name: string } | null };
type Tab = "customer" | "received" | "balances" | "history";

export default function Payments() {
  const { can, search, notify } = useAdmin();
  const [tab, setTab] = useState<Tab>("customer");
  const [days, setDays] = useState(30);
  const [pay, setPay] = useState<Balance | null>(null);
  const range = useMemo(() => dayRange(days), [days]);
  const sum = useLoad(() => callRpc<Summary>("payments_summary", range), [days]);
  const rec = useLoad(() => callRpc<Received[]>("payments_received", { ...range, p_limit: 500 }), [days]);
  const bal = useLoad(() => callRpc<Balance[]>("payout_balances"), []);
  const his = useLoad(async () => {
    const { data, error } = await requireSupabase().from("supplier_payouts").select("id, amount, method, reference, note, paid_at, suppliers(name)").order("paid_at", { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as unknown as Payout[];
  }, []);
  const cstats = useLoad(() => callRpc<{ awaiting_verification: number; cod_to_collect: number; refunded: number }>("payment_stats"), []);
  const [rcpt, setRcpt] = useState<PayoutRec | null>(null);
  const s = search.toLowerCase();
  const owed = (bal.data ?? []).reduce((a, b) => a + Number(b.balance), 0);
  const canPay = can("payments.manage");
  const refreshAll = () => { sum.reload(); bal.reload(); his.reload(); };

  const need = cstats.data;
  const dueSuppliers = (bal.data ?? []).filter(b => Number(b.balance) > 0).length;
  const mix = sum.data?.by_method ?? [];
  const mixTotal = mix.reduce((a, m) => a + Number(m.amount), 0);
  const initial = (n: string) => (n.trim()[0] ?? "?").toUpperCase();

  return (
    <div className="pm">
      <section className="pm-hero" aria-label="Money overview">
        <div className="pm-hero-top">
          <div><small>Money overview</small><h1>Payments &amp; Payouts</h1><p>Money received from customers and paid out to suppliers.</p></div>
          <select aria-label="Period" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
          </select>
        </div>
        <ErrorNote text={sum.error} />
        <div className="pm-kpis">
          <div className="pm-kpi in"><span><ArrowDownToLine /></span><small>Received</small><b>{money(Number(sum.data?.received ?? 0))}</b></div>
          <div className="pm-kpi wait"><span><Clock /></span><small>Owed by customers</small><b>{money(Number(sum.data?.outstanding ?? 0))}</b></div>
          <div className="pm-kpi out"><span><ArrowUpFromLine /></span><small>Paid to suppliers</small><b>{money(Number(sum.data?.paid_out ?? 0))}</b></div>
          <div className="pm-kpi owe"><span><HandCoins /></span><small>Owed to suppliers</small><b>{money(owed)}</b></div>
        </div>
        {mixTotal > 0 && (
          <div className="pm-mix" aria-label="How customers paid">
            <div className="pm-bar" role="img" aria-label={mix.map(m => `${label(m.method)} ${money(Number(m.amount))}`).join(", ")}>
              {mix.map((m, i) => <i key={m.method} className={`c${i % 4}`} style={{ width: `${Math.max(3, (Number(m.amount) / mixTotal) * 100)}%` }} />)}
            </div>
            <ul>{mix.map((m, i) => <li key={m.method}><i className={`c${i % 4}`} />{label(m.method)} <b>{money(Number(m.amount))}</b></li>)}</ul>
          </div>)}
      </section>

      <section className="pm-attn" aria-label="Needs attention">
        <button className={`pm-a ${(need?.awaiting_verification ?? 0) > 0 ? "hot" : ""}`} onClick={() => setTab("customer")}><span><ShieldCheck /></span><div><b>{need?.awaiting_verification ?? 0}</b><small>Transfers to verify</small></div></button>
        <button className="pm-a" onClick={() => setTab("customer")}><span><Banknote /></span><div><b>{money(Number(need?.cod_to_collect ?? 0))}</b><small>Cash to collect</small></div></button>
        <button className={`pm-a ${dueSuppliers > 0 ? "hot" : ""}`} onClick={() => setTab("balances")}><span><Wallet /></span><div><b>{dueSuppliers}</b><small>{dueSuppliers === 1 ? "Supplier to pay" : "Suppliers to pay"}</small></div></button>
        <button className="pm-a" onClick={() => setTab("customer")}><span><Undo2 /></span><div><b>{money(Number(need?.refunded ?? 0))}</b><small>Refunded</small></div></button>
      </section>

      <Tabs label="Payments views" value={tab} onChange={setTab} tabs={[
        { id: "customer", label: "Customer payments", icon: <Banknote />, count: need?.awaiting_verification },
        { id: "received", label: "Sales received", icon: <Receipt /> },
        { id: "balances", label: "Supplier balances", icon: <Wallet />, count: dueSuppliers },
        { id: "history", label: "Payout history", icon: <HandCoins /> },
      ]} />

      {tab === "customer" && <CustomerPayments onChanged={cstats.reload} />}

      {tab === "received" && <>
        <ErrorNote text={rec.error} />
        <div className="pm-list">
          {(rec.data ?? []).filter(r => `${r.receipt_number} ${r.customer_name}`.toLowerCase().includes(s)).map(r => {
            const pct = Number(r.total_amount) > 0 ? Math.min(100, (Number(r.amount_paid) / Number(r.total_amount)) * 100) : 100;
            return (
              <div key={r.sale_id} className="pm-card static">
                <span className="pm-ic in"><Receipt /></span>
                <span className="pm-main"><b>{r.receipt_number} <em>{r.customer_name}</em></b><small>{r.payment_method ? label(r.payment_method) : "No method"} · {dateOf(r.sold_at)}</small>
                  <span className="pm-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span></span>
                <span className="pm-end"><b>{money(Number(r.total_amount))}</b>
                  {Number(r.outstanding) > 0 ? <span className="pm-pill warn">Owes {money(Number(r.outstanding))}</span> : <span className="pm-pill good">Paid</span>}</span>
              </div>);
          })}
          {!(rec.data ?? []).length && <div className="pm-empty"><Inbox /><b>{rec.loading ? "Loading…" : "No sales payments in this period"}</b></div>}
        </div>
      </>}

      {tab === "balances" && <>
        <ErrorNote text={bal.error} />
        <p className="pm-note"><Wallet size={16} /> A supplier earns the supplier price minus TradeLink's commission on each sale. Suppliers must be verified before they can be paid.</p>
        <div className="pm-list">
          {(bal.data ?? []).filter(b => b.supplier_name.toLowerCase().includes(s)).map(b => {
            const pct = Number(b.earned) > 0 ? Math.min(100, (Number(b.paid) / Number(b.earned)) * 100) : 0;
            return (
              <div key={b.supplier_id} className="pm-card static sup">
                <span className="pm-av">{initial(b.supplier_name)}</span>
                <span className="pm-main"><b>{b.supplier_name} {b.verified ? <span className="pm-pill good">Verified</span> : <span className="pm-pill warn">Not verified</span>}</b>
                  <small>Earned {money(Number(b.earned))} · Paid {money(Number(b.paid))} · Last payout {dateOf(b.last_paid)}</small>
                  <span className="pm-meter" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span></span>
                <span className="pm-end"><small>{Number(b.earned) > 0 ? "Balance owed" : "No sales yet"}</small><b>{money(Number(b.balance))}</b>
                  {canPay && Number(b.balance) > 0 && <span className="pm-go hot" role="button" tabIndex={0} onClick={() => b.verified ? setPay(b) : notify("Verify this supplier first, in Supplier Verification.")}
                    onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLElement).click(); }}>Pay</span>}</span>
              </div>);
          })}
          {!(bal.data ?? []).length && <div className="pm-empty"><Inbox /><b>{bal.loading ? "Loading…" : "No approved suppliers yet"}</b><small>{bal.loading ? "" : "Approved suppliers appear here, with what they have earned from sales."}</small></div>}
        </div>
      </>}

      {tab === "history" && <>
        <ErrorNote text={his.error} />
        <div className="pm-list">
          {(his.data ?? []).filter(p => `${p.suppliers?.name ?? ""} ${p.reference ?? ""}`.toLowerCase().includes(s)).map(p => (
            <div key={p.id} className="pm-card static">
              <span className="pm-ic out"><ArrowUpFromLine /></span>
              <span className="pm-main"><b>{p.suppliers?.name ?? "Supplier"}</b><small>{dateOf(p.paid_at)} · {label(p.method)}{p.reference ? ` · ${p.reference}` : ""}{p.note ? ` · ${p.note}` : ""}</small></span>
              <span className="pm-end"><b>{money(Number(p.amount))}</b><span className="pm-go" role="button" tabIndex={0} onClick={() => setRcpt({ id: p.id, supplier_name: p.suppliers?.name ?? "Supplier", amount: Number(p.amount), method: p.method, reference: p.reference, note: p.note, paid_at: p.paid_at })} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLElement).click(); }}>Receipt</span></span>
            </div>))}
          {!(his.data ?? []).length && <div className="pm-empty"><Inbox /><b>{his.loading ? "Loading…" : "No payouts recorded yet"}</b></div>}
        </div>
      </>}

      {pay && <PayModal b={pay} onClose={() => setPay(null)} onDone={r => { setPay(null); refreshAll(); setRcpt(r); }} />}
      {rcpt && <PayoutReceipt r={rcpt} onClose={() => setRcpt(null)} />}
    </div>
  );
}

function PayModal({ b, onClose, onDone }: { b: Balance; onClose: () => void; onDone: (r: PayoutRec) => void }) {
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(String(Number(b.balance)));
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const submit = async () => {
    let id = "";
    const ok = await run(async () => { id = await callRpc<string>("record_payout", { p_supplier: b.supplier_id, p_amount: Number(amount), p_method: method, p_reference: ref, p_note: note }); }, "Payout recorded. The supplier has been notified.");
    if (ok) onDone({ id, supplier_name: b.supplier_name, amount: Number(amount), method, reference: ref.trim() || null, note: note.trim() || null, paid_at: new Date().toISOString() });
  };
  return (
    <Modal title={`Pay ${b.supplier_name}`} kicker="RECORD PAYOUT" onClose={onClose}>
      <p className="su-muted">Balance owed: <b>{money(Number(b.balance))}</b>. Record the payment after you have sent the money; it cannot be edited afterwards.</p>
      <Form onSubmit={() => void submit()} busy={busy} submit="Record payout">
        <div className="two">
          <label>Amount (ETB)<input type="number" min="0.01" step="0.01" max={Number(b.balance)} required value={amount} onChange={e => setAmount(e.target.value)} /></label>
          <label>Method<select value={method} onChange={e => setMethod(e.target.value)}><option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="cash">Cash</option></select></label>
        </div>
        <label>Reference (optional)<input maxLength={80} value={ref} onChange={e => setRef(e.target.value)} placeholder="Transaction number" /></label>
        <label>Note (optional)<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>
      </Form>
    </Modal>
  );
}
