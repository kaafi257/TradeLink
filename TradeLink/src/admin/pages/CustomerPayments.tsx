import { useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, Clock, FileText, Landmark, Plug, RotateCcw, ShieldCheck, Undo2 } from "lucide-react";
import { DataTable, SummaryStrip } from "../../components/ui";
import { StatusChip } from "../Records";
import { METHOD_LABEL, STATUS_LABEL, type PayMethod, type PayStatus } from "../../lib/checkout";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, callRpc, dateOf, dayRange, useAction, useLoad } from "../suite";

type Row = {
  id: string; order_number: string; customer_name: string; phone: string; method: PayMethod; amount: number; status: PayStatus; reference: string; customer_txn_ref: string | null;
  proof_path: string | null; submitted_at: string | null; created_at: string; verified_at: string | null; collected_at: string | null; review_note: string | null; refunded: number;
};
type Stats = { awaiting_verification: number; cod_to_collect: number; refunded: number; by_status: Record<string, { count: number; amount: number }>; by_method: Record<string, { count: number; amount: number }> };
type Provider = { key: string; name: string; state: "live" | "off" | "not_configured"; detail: string };
type Audit = { created_at: string; actor_kind: string; actor_name: string | null; event: string; from_status: string | null; to_status: string | null; note: string | null };
type Recon = { order_number: string; customer_name: string; order_total: number; amount_paid: number; payments_paid: number; difference: number };
type Settings = { cod_enabled: boolean; bank_enabled: boolean; bank_name: string | null; account_name: string | null; account_number: string | null; bank_note: string | null; delivery_fee: number; free_delivery_over: number | null; bank_hold_hours: number;
  telebirr_enabled: boolean; telebirr_name: string | null; telebirr_number: string | null; ebirr_enabled: boolean; ebirr_name: string | null; ebirr_number: string | null };

const etb = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0)} ETB`;
const tone = (s: PayStatus) => (s === "paid" ? "good" : s === "failed" || s === "expired" || s === "cancelled" ? "bad" : s === "refunded" || s === "partially_refunded" ? "info" : "warn");
const STATUSES: PayStatus[] = ["pending", "submitted", "processing", "paid", "failed", "expired", "cancelled", "refunded", "partially_refunded"];

export default function CustomerPayments() {
  const { can, search } = useAdmin();
  const [days, setDays] = useState(30);
  const [method, setMethod] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const [settings, setSettings] = useState(false);
  const range = dayRange(days);
  const term = (q || search).trim();
  const list = useLoad(() => callRpc<Row[]>("payment_list", { p_search: term || null, p_method: method || null, p_status: status || null, p_from: range.p_from, p_to: range.p_to, p_limit: 300 }), [term, method, status, days]);
  const stats = useLoad(() => callRpc<Stats>("payment_stats"), []);
  const prov = useLoad(() => callRpc<Provider[]>("payment_providers"), []);
  const recon = useLoad(() => callRpc<Recon[]>("payment_reconciliation"), []);
  const refresh = () => { list.reload(); stats.reload(); recon.reload(); };
  const rows = list.data ?? [];
  const failed = rows.filter(r => r.status === "failed" || r.status === "expired");

  return (
    <>
      <ErrorNote text={list.error || stats.error} />
      <SummaryStrip items={[
        { icon: <Clock />, tone: "gold", value: stats.data?.awaiting_verification ?? 0, label: "Transfers to verify" },
        { icon: <Banknote />, tone: "blue", value: etb(stats.data?.cod_to_collect ?? 0), label: "Cash to collect" },
        { icon: <CheckCircle2 />, tone: "mint", value: stats.data?.by_status?.paid?.count ?? 0, label: "Paid" },
        { icon: <Undo2 />, tone: "red", value: etb(stats.data?.refunded ?? 0), label: "Refunded" },
      ]} />

      <div className="su-row" style={{ margin: "0 0 14px" }} aria-label="Payment providers">
        {(prov.data ?? []).map(p => (
          <StatusChip key={p.key} tone={p.state === "live" ? "good" : p.state === "off" ? "muted" : "info"} icon={p.state === "live" ? <ShieldCheck size={14} /> : <Plug size={14} />}>
            {p.name} · {p.state === "live" ? "On" : p.state === "off" ? "Off" : "Not set up"}
          </StatusChip>
        ))}
        {can("payments.manage") && <button className="btn outline" onClick={() => setSettings(true)}><Landmark size={15} /> Checkout settings</button>}
      </div>

      <div className="inline-form" role="search">
        <label>Search<input value={q} onChange={e => setQ(e.target.value)} placeholder="Order number, payment or transfer reference, name, phone" /></label>
        <label>Method<select value={method} onChange={e => setMethod(e.target.value)}><option value="">All</option><option value="bank_transfer">Bank transfer</option><option value="telebirr">Telebirr</option><option value="ebirr">eBirr</option><option value="cod">Cash on Delivery</option></select></label>
        <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label>Period<select value={days} onChange={e => setDays(Number(e.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select></label>
      </div>

      <DataTable headers={["Order", "Customer", "Method", "Amount", "Status", "Reference", "Date", ""]} isEmpty={!rows.length} empty={list.loading ? "Loading…" : "No customer payments match. Orders placed at checkout appear here."}>
        {rows.map(r => (
          <tr key={r.id}>
            <td><span className="docno">{r.order_number}</span></td><td>{r.customer_name}<br /><small>{r.phone}</small></td><td>{METHOD_LABEL[r.method]}</td>
            <td><b>{etb(r.amount)}</b>{Number(r.refunded) > 0 && <><br /><small>refunded {etb(r.refunded)}</small></>}</td>
            <td><span className={`status ${tone(r.status) === "good" ? "good" : tone(r.status) === "bad" ? "muted" : "warn"}`}>{STATUS_LABEL[r.status]}</span></td>
            <td><small>{r.reference}</small>{r.customer_txn_ref && <><br /><small>Txn {r.customer_txn_ref}</small></>}</td>
            <td>{dateOf(r.created_at)}</td>
            <td><button className="btn outline" onClick={() => setOpen(r)}>{r.status === "submitted" && can("payments.verify") ? "Verify" : "Open"}</button></td>
          </tr>
        ))}
      </DataTable>

      {failed.length > 0 && <p className="inline-note"><AlertTriangle size={14} /> {failed.length} failed or expired {failed.length === 1 ? "payment" : "payments"} in this list. Filter by status to review them.</p>}

      <h3 style={{ margin: "22px 0 8px" }}>Reconciliation</h3>
      {(recon.data ?? []).length === 0
        ? <div className="info-banner"><CheckCircle2 /> {recon.loading ? "Checking…" : "Every checkout order's paid amount matches its verified payments."}</div>
        : <DataTable headers={["Order", "Customer", "Total", "Recorded paid", "Verified payments", "Difference"]} isEmpty={false} empty="">
            {(recon.data ?? []).map(r => <tr key={r.order_number}><td><span className="docno">{r.order_number}</span></td><td>{r.customer_name}</td><td>{etb(r.order_total)}</td><td>{etb(r.amount_paid)}</td><td>{etb(r.payments_paid)}</td><td><span className="status warn">{etb(r.difference)}</span></td></tr>)}
          </DataTable>}

      {open && <Detail row={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} onSaved={() => { setSettings(false); prov.reload(); }} />}
    </>
  );
}

function Detail({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { can } = useAdmin();
  const { busy, run } = useAction();
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState("");
  const [cash, setCash] = useState(String(row.amount));
  const [proofUrl, setProofUrl] = useState("");
  const audit = useLoad(() => callRpc<Audit[]>("payment_audit", { p_payment: row.id }), [row.id]);
  const left = Number(row.amount) - Number(row.refunded);
  const act = (fn: () => Promise<unknown>, msg: string) => void run(fn, msg).then(ok => { if (ok) onDone(); });

  const viewProof = async () => {
    const { data, error } = await requireSupabase().storage.from("payment-proofs").createSignedUrl(row.proof_path!, 120);
    if (error || !data) return;
    setProofUrl(data.signedUrl); window.open(data.signedUrl, "_blank", "noopener");
  };

  return (
    <Modal title={`${row.order_number} · ${etb(row.amount)}`} kicker={METHOD_LABEL[row.method].toUpperCase()} onClose={onClose}>
      <p className="su-muted">{row.customer_name} · {row.phone} · <b>{STATUS_LABEL[row.status]}</b> · payment {row.reference}{row.customer_txn_ref ? ` · customer reference ${row.customer_txn_ref}` : ""}</p>
      {row.review_note && <p className="su-muted">Note: {row.review_note}</p>}
      {row.proof_path && <p><button className="btn outline" onClick={() => void viewProof()}><FileText size={15} /> Open receipt file</button>{proofUrl && <small> opened in a new tab</small>}<br /><small className="su-muted">A receipt file or screenshot is only a hint and can be faked. Mark it paid only after you see the money in the bank account or in the Telebirr / eBirr app.</small></p>}

      {row.method !== "cod" && row.status === "submitted" && can("payments.verify") && (
        <Form onSubmit={() => act(() => callRpc("verify_bank_payment", { p_payment: row.id, p_approve: true, p_note: note }), "Transfer verified. The order is paid.")} busy={busy} submit="I see the money. Mark as paid">
          <label>Note or reason (a reason is required to reject)<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. matches statement line 4012 / amount does not match" /></label>
          <button type="button" className="btn outline" disabled={busy || !note.trim()} onClick={() => act(() => callRpc("verify_bank_payment", { p_payment: row.id, p_approve: false, p_note: note }), "Transfer rejected. The customer can send new details.")}>Reject transfer</button>
        </Form>
      )}
      {row.method !== "cod" && row.status === "submitted" && !can("payments.verify") && <div className="info-banner">You can view this transfer, but only people with permission to verify transfers can mark it paid.</div>}

      {row.method === "cod" && ["pending", "processing"].includes(row.status) && can("payments.collect") && (
        <Form onSubmit={() => act(() => callRpc("confirm_cod_collection", { p_payment: row.id, p_amount: Number(cash), p_note: note }), "Cash collection confirmed.")} busy={busy} submit="Cash received. Mark as paid">
          <label>Cash collected (ETB). It must equal the amount due<input type="number" step="0.01" min="0.01" value={cash} onChange={e => setCash(e.target.value)} /></label>
          <label>Note (optional)<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>
        </Form>
      )}

      {["paid", "partially_refunded"].includes(row.status) && can("payments.refund") && (
        <Form onSubmit={() => act(() => callRpc("refund_payment", { p_payment: row.id, p_amount: Number(refund), p_reason: note }), "Refund recorded.")} busy={busy} submit="Record refund">
          <p className="su-muted">This only <b>records</b> a refund. Send the money back yourself first (bank or cash). Left to refund: {etb(left)}.</p>
          <div className="two">
            <label>Amount (ETB)<input type="number" step="0.01" min="0.01" max={left} required value={refund} onChange={e => setRefund(e.target.value)} /></label>
            <label>Reason<input required minLength={3} maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>
          </div>
        </Form>
      )}

      {["pending", "submitted", "processing", "failed"].includes(row.status) && can("payments.manage") && (
        <button className="btn outline" disabled={busy} onClick={() => act(() => callRpc("cancel_payment", { p_payment: row.id, p_note: note }), "Payment cancelled.")}><RotateCcw size={15} /> Cancel this payment</button>
      )}

      <h4 style={{ margin: "18px 0 6px" }}>History</h4>
      <ErrorNote text={audit.error} />
      <ul className="su-muted" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 6 }}>
        {(audit.data ?? []).map((a, i) => <li key={i}><b>{a.event.replace(/_/g, " ")}</b> · {a.actor_name ?? a.actor_kind} · {new Date(a.created_at).toLocaleString()}{a.from_status ? ` · ${a.from_status} → ${a.to_status}` : ""}{a.note ? ` · ${a.note}` : ""}</li>)}
        {!audit.loading && !(audit.data ?? []).length && <li>No history yet.</li>}
      </ul>
    </Modal>
  );
}

function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { busy, run } = useAction();
  const cur = useLoad(async () => {
    const { data, error } = await requireSupabase().from("checkout_settings").select("*").maybeSingle();
    if (error) throw error;
    return data as Settings;
  }, []);
  const [f, setF] = useState<Partial<Settings> | null>(null);
  const v: Partial<Settings> = f ?? cur.data ?? {};
  const set = (patch: Partial<Settings>) => setF({ ...v, ...patch });
  return (
    <Modal title="Checkout settings" kicker="PAYMENT METHODS" onClose={onClose}>
      <ErrorNote text={cur.error} />
      <p className="su-muted">Customers see only the methods you switch on here. Telebirr and eBirr here are manual: the customer sends money to your number and you check it in the app. They are not connected to the providers by API. CBE Birr is not set up.</p>
      <Form onSubmit={() => void run(() => callRpc("save_checkout_settings", { p_settings: v }), "Settings saved.").then(ok => { if (ok) onSaved(); })} busy={busy || cur.loading} submit="Save settings">
        <label className="checkbox-label"><input type="checkbox" checked={!!v.bank_enabled} onChange={e => set({ bank_enabled: e.target.checked })} /> Accept bank transfer (CBE)</label>
        <div className="two">
          <label>Bank name<input maxLength={80} value={v.bank_name ?? ""} onChange={e => set({ bank_name: e.target.value })} placeholder="Commercial Bank of Ethiopia" /></label>
          <label>Account name<input maxLength={120} value={v.account_name ?? ""} onChange={e => set({ account_name: e.target.value })} /></label>
        </div>
        <label>Account number<input maxLength={40} value={v.account_number ?? ""} onChange={e => set({ account_number: e.target.value })} inputMode="numeric" /></label>
        <label>Note shown with the account (optional)<input maxLength={300} value={v.bank_note ?? ""} onChange={e => set({ bank_note: e.target.value })} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={!!v.telebirr_enabled} onChange={e => set({ telebirr_enabled: e.target.checked })} /> Accept Telebirr (customer pays your number, you verify)</label>
        <div className="two">
          <label>Telebirr account name<input maxLength={120} value={v.telebirr_name ?? ""} onChange={e => set({ telebirr_name: e.target.value })} /></label>
          <label>Telebirr number<input maxLength={20} inputMode="tel" value={v.telebirr_number ?? ""} onChange={e => set({ telebirr_number: e.target.value })} /></label>
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={!!v.ebirr_enabled} onChange={e => set({ ebirr_enabled: e.target.checked })} /> Accept eBirr (customer pays your number, you verify)</label>
        <div className="two">
          <label>eBirr account name<input maxLength={120} value={v.ebirr_name ?? ""} onChange={e => set({ ebirr_name: e.target.value })} /></label>
          <label>eBirr number<input maxLength={20} inputMode="tel" value={v.ebirr_number ?? ""} onChange={e => set({ ebirr_number: e.target.value })} /></label>
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={!!v.cod_enabled} onChange={e => set({ cod_enabled: e.target.checked })} /> Accept Cash on Delivery</label>
        <div className="two">
          <label>Delivery fee (ETB)<input type="number" min="0" step="0.01" value={v.delivery_fee ?? 0} onChange={e => set({ delivery_fee: Number(e.target.value) })} /></label>
          <label>Free delivery over (ETB, optional)<input type="number" min="0" step="0.01" value={v.free_delivery_over ?? ""} onChange={e => set({ free_delivery_over: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        </div>
        <label>Hours to wait for a bank transfer before the order expires<input type="number" min="1" max="720" value={v.bank_hold_hours ?? 72} onChange={e => set({ bank_hold_hours: Number(e.target.value) })} /></label>
      </Form>
    </Modal>
  );
}
