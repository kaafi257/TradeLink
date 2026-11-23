import { useState } from "react";
import { AlertTriangle, Banknote, CheckCircle2, ChevronRight, FileText, Inbox, Landmark, Plug, RotateCcw, Search, Settings, ShieldCheck, Smartphone } from "lucide-react";
import { METHOD_LABEL, STATUS_LABEL, type PayMethod, type PayStatus } from "../../lib/checkout";
import { errorText, requireSupabase } from "../../lib/supabase";
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

const MethodIcon = ({ m }: { m: PayMethod }) => (m === "cod" ? <Banknote /> : m === "bank_transfer" ? <Landmark /> : <Smartphone />);
const FILTERS: { id: string; label: string; hot?: boolean }[] = [
  { id: "", label: "All" }, { id: "submitted", label: "To verify", hot: true }, { id: "pending", label: "Pending" },
  { id: "paid", label: "Paid" }, { id: "failed", label: "Failed" }, { id: "refunded", label: "Refunded" },
];

export default function CustomerPayments({ onChanged }: { onChanged?: () => void }) {
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
  const refresh = () => { list.reload(); stats.reload(); recon.reload(); onChanged?.(); };
  const rows = list.data ?? [];
  const by = stats.data?.by_status ?? {};
  const total = Object.values(by).reduce((a, c) => a + Number(c.count), 0);
  const countOf = (id: string) => (id === "" ? total : Number(by[id]?.count ?? 0));

  return (
    <>
      <ErrorNote text={list.error || stats.error} />

      <section className="pm-providers" aria-label="Ways customers can pay">
        {(prov.data ?? []).map(p => (
          <div key={p.key} className={`pm-prov ${p.state}`}>
            <span className="pm-prov-ic">{p.key === "cod" ? <Banknote /> : p.key === "bank_transfer" ? <Landmark /> : p.state === "not_configured" ? <Plug /> : <Smartphone />}</span>
            <div><b>{p.name}</b><small>{p.state === "live" ? "On" : p.state === "off" ? "Off" : "Not set up"}</small></div>
            <i aria-hidden="true" />
          </div>
        ))}
        {can("payments.manage") && <button className="pm-prov set" onClick={() => setSettings(true)}><span className="pm-prov-ic"><Settings /></span><div><b>Checkout settings</b><small>Accounts, fees, methods</small></div></button>}
      </section>

      <div className="pm-filters" role="group" aria-label="Filter by status">
        {FILTERS.map(f => (
          <button key={f.id} className={`${status === f.id ? "on" : ""}${f.hot && countOf(f.id) > 0 ? " hot" : ""}`} onClick={() => setStatus(f.id)} aria-pressed={status === f.id}>
            {f.label}<i>{countOf(f.id)}</i>
          </button>
        ))}
      </div>

      <div className="pm-toolbar" role="search">
        <label className="pm-search"><Search size={17} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Order number, reference, name or phone" aria-label="Search payments" /></label>
        <select value={method} onChange={e => setMethod(e.target.value)} aria-label="Method"><option value="">All methods</option><option value="bank_transfer">Bank transfer</option><option value="telebirr">Telebirr</option><option value="ebirr">eBirr</option><option value="cod">Cash on Delivery</option></select>
        <select value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Period"><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option></select>
      </div>

      <div className="pm-list">
        {rows.map(r => (
          <button key={r.id} className={`pm-card ${r.status === "submitted" ? "attn" : ""}`} onClick={() => setOpen(r)}>
            <span className={`pm-ic ${r.method}`}><MethodIcon m={r.method} /></span>
            <span className="pm-main">
              <b>{r.order_number} <em>{r.customer_name}</em></b>
              <small>{METHOD_LABEL[r.method]} · {dateOf(r.created_at)}{r.customer_txn_ref ? ` · ${r.customer_txn_ref}` : ""}</small>
            </span>
            <span className="pm-end">
              <b>{etb(r.amount)}</b>
              <span className={`pm-pill ${tone(r.status)}`}>{STATUS_LABEL[r.status]}</span>
              {Number(r.refunded) > 0 && <small>refunded {etb(r.refunded)}</small>}
            </span>
            {r.status === "submitted" && can("payments.verify") ? <span className="pm-go hot">Verify</span> : <ChevronRight className="pm-chev" size={18} />}
          </button>
        ))}
        {!rows.length && <div className="pm-empty"><Inbox /><b>{list.loading ? "Loading…" : "No customer payments here"}</b><small>{list.loading ? "" : "Orders placed at checkout appear here, with the payment method and status."}</small></div>}
      </div>

      <section className="pm-panel" aria-label="Reconciliation">
        <header><span className="pm-ic blue"><ShieldCheck /></span><div><b>Reconciliation</b><small>Does each order's paid amount match its verified payments?</small></div></header>
        {(recon.data ?? []).length === 0
          ? <p className="pm-ok"><CheckCircle2 size={18} /> {recon.loading ? "Checking…" : "All matched. Nothing to fix."}</p>
          : <div className="pm-list">{(recon.data ?? []).map(r => (
              <div key={r.order_number} className="pm-card static"><span className="pm-ic warn"><AlertTriangle /></span>
                <span className="pm-main"><b>{r.order_number} <em>{r.customer_name}</em></b><small>Recorded {etb(r.amount_paid)} · verified {etb(r.payments_paid)}</small></span>
                <span className="pm-end"><b>{etb(r.difference)}</b><span className="pm-pill warn">Difference</span></span></div>))}</div>}
      </section>

      {open && <Detail row={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); refresh(); }} />}
      {settings && <SettingsModal onClose={() => setSettings(false)} onSaved={() => { setSettings(false); prov.reload(); onChanged?.(); }} />}
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

const WALLET = /^[0-9+ -]{6,20}$/;
/** Checks the form before sending, and says exactly what to fix. */
function problem(v: Partial<Settings>): string {
  if (v.bank_enabled && !(v.bank_name?.trim() && v.account_name?.trim() && v.account_number?.trim())) return "Bank transfer is ticked: enter the bank name, account name and account number.";
  for (const [on, name, num, label] of [[v.telebirr_enabled, v.telebirr_name, v.telebirr_number, "Telebirr"], [v.ebirr_enabled, v.ebirr_name, v.ebirr_number, "eBirr"]] as const) {
    if (on && !(name?.trim() && num?.trim())) return `${label} is ticked: enter the ${label} account name and number.`;
    if (num?.trim() && !WALLET.test(num.trim())) return `The ${label} number must be 6 to 20 digits (a + or spaces are fine). Letters like X are not allowed.`;
  }
  return "";
}

function SettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { notify } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
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
      <Form onSubmit={() => {
        const bad = problem(v);
        if (bad) { setErr(bad); return; }
        setErr(""); setBusy(true);
        callRpc("save_checkout_settings", { p_settings: v })
          .then(() => { notify("Settings saved."); onSaved(); })
          .catch(e => setErr(errorText(e, "Could not save. Please try again.")))
          .finally(() => setBusy(false));
      }} busy={busy || cur.loading} submit="Save settings">
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
        <label>Hours to wait for a payment before the order expires (72 is usual)<input type="number" min="1" max="720" value={v.bank_hold_hours ?? 72} onChange={e => set({ bank_hold_hours: Number(e.target.value) })} /></label>
        <ErrorNote text={err} />
      </Form>
    </Modal>
  );
}
