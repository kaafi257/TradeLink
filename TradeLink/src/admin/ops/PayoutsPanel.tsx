import { useState } from "react";
import { Banknote, History as HistoryIcon, Receipt } from "lucide-react";
import { callRpc, dateOf, ErrorNote, Form, Modal, useAction, useLoad } from "../suite";

type Row = { driver: string; name: string; deliveries: number; earned: number; unpriced: number; earnedAll: number; paidAll: number; owed: number; paidInPeriod: number };
type Over = { canPay: boolean; rows: Row[] };
type Pay = { id: string; amount: number; method: string; reference: string | null; paidOn: string; periodFrom: string | null; periodTo: string | null; note: string | null; by: string | null; at: string; voided: boolean; voidReason: string | null };
const etb = (n: number) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB`;
const iso = (d: Date) => d.toLocaleDateString("en-CA");
const METHODS: [string, string][] = [["cash", "Cash"], ["bank_transfer", "Bank transfer"], ["telebirr", "Telebirr"], ["ebirr", "eBirr"], ["other", "Other"]];

function PayModal({ row, from, to, onClose, onDone }: { row: Row; from: string; to: string; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ amount: String(row.owed), method: "cash", reference: "", paidOn: iso(new Date()), note: "" });
  return (
    <Modal title={row.name} kicker="RECORD A PAYOUT" onClose={onClose}>
      <p className="ops-empty">Still owed: {etb(row.owed)}. Record a payment only after you have actually paid it. TradeLink does not send money.</p>
      <Form busy={busy} submit="Save payout" onSubmit={() => void run(() => callRpc("ops_record_payout", { p_driver: row.driver, p_amount: Number(f.amount), p_method: f.method, p_reference: f.reference, p_paid_on: f.paidOn, p_from: from, p_to: to, p_note: f.note }), "Payout recorded.").then(ok => { if (ok) onDone(); })}>
        <label>Amount paid (ETB)<input inputMode="decimal" required value={f.amount} onChange={e => setF({ ...f, amount: e.target.value.replace(/[^0-9.]/g, "") })} /></label>
        <label>How was it paid<select value={f.method} onChange={e => setF({ ...f, method: e.target.value })}>{METHODS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {f.method !== "cash" && <label>Transfer reference<input required maxLength={80} value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></label>}
        <label>Date paid<input type="date" required max={iso(new Date())} value={f.paidOn} onChange={e => setF({ ...f, paidOn: e.target.value })} /></label>
        <label>Note (optional)<input maxLength={300} value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
      </Form>
    </Modal>
  );
}

function History({ row, canPay, onClose, onChanged }: { row: Row; canPay: boolean; onClose: () => void; onChanged: () => void }) {
  const list = useLoad(() => callRpc<Pay[]>("ops_driver_payouts", { p_driver: row.driver }), [row.driver]);
  const { busy, run } = useAction();
  const [why, setWhy] = useState<Record<string, string>>({});
  return (
    <Modal title={row.name} kicker="PAYOUT HISTORY" onClose={onClose}>
      <ErrorNote text={list.error} />
      {list.data?.length === 0 && <p className="ops-empty">No payouts recorded yet.</p>}
      {list.data?.map(p => (
        <div key={p.id} className={`pay-hist ${p.voided ? "void" : ""}`}>
          <b>{etb(p.amount)}</b><span>{dateOf(p.paidOn)} · {p.method.replace(/_/g, " ")}{p.reference ? ` · ${p.reference}` : ""}</span>
          <small>Recorded by {p.by ?? "staff"}{p.note ? ` · ${p.note}` : ""}</small>
          {p.voided && <small className="warn">Cancelled: {p.voidReason}</small>}
          {canPay && !p.voided && (
            <div className="pay-void"><input aria-label="Why cancel this record" placeholder="Why is this record wrong?" value={why[p.id] ?? ""} onChange={e => setWhy(w => ({ ...w, [p.id]: e.target.value }))} />
              <button type="button" className="ops-pill" disabled={busy || (why[p.id] ?? "").trim().length < 5} onClick={() => void run(() => callRpc("ops_void_payout", { p_payout: p.id, p_reason: why[p.id] }).then(() => { list.reload(); onChanged(); }), "Record cancelled.")}>Cancel record</button></div>
          )}
        </div>
      ))}
    </Modal>
  );
}

/** Driver earnings for a period, what has been paid, and what is still owed. Payouts are recorded by hand and kept permanently. */
export default function PayoutsPanel() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => iso(new Date()));
  const o = useLoad(() => callRpc<Over>("ops_driver_earnings", { p_from: from, p_to: to }), [from, to]);
  const [pay, setPay] = useState<Row | null>(null);
  const [hist, setHist] = useState<Row | null>(null);
  return (
    <section className="cty" aria-label="Driver payouts">
      <ErrorNote text={o.error} />
      <div className="prc-range">
        <label>From<input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} /></label>
      </div>
      {o.data?.rows.length === 0 && <p className="ops-empty">No delivery drivers yet.</p>}
      {o.data?.rows.map(r => (
        <article key={r.driver} className="cty-card">
          <header><b>{r.name}</b><small>{r.deliveries} delivered in this period</small></header>
          <div className="pay-nums">
            <div><span>Earned</span><b>{etb(r.earned)}</b></div>
            <div><span>Paid in period</span><b>{etb(r.paidInPeriod)}</b></div>
            <div className={r.owed > 0 ? "owe" : ""}><span>Owed (all time)</span><b>{etb(r.owed)}</b></div>
          </div>
          {r.unpriced > 0 && <p className="ops-empty warn">{r.unpriced} delivered job{r.unpriced > 1 ? "s have" : " has"} no pay set. Set it on the delivery or add a pay rate.</p>}
          <div className="prc-act">
            {o.data?.canPay && <button type="button" className="drs-btn" disabled={r.owed <= 0} onClick={() => setPay(r)}><Banknote size={16} /> Record payout</button>}
            <button type="button" className="ops-pill" onClick={() => setHist(r)}><HistoryIcon size={14} /> History</button>
          </div>
        </article>
      ))}
      {o.data && !o.data.canPay && <p className="ops-empty"><Receipt size={14} /> Only the owner can record payouts.</p>}
      {pay && <PayModal row={pay} from={from} to={to} onClose={() => setPay(null)} onDone={() => { setPay(null); o.reload(); }} />}
      {hist && <History row={hist} canPay={!!o.data?.canPay} onClose={() => setHist(null)} onChanged={o.reload} />}
    </section>
  );
}
