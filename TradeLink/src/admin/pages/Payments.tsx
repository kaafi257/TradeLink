import { useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Banknote, Clock, HandCoins, Receipt, Wallet } from "lucide-react";
import { DataTable, PageHeading, SummaryStrip } from "../../components/ui";
import { StatusChip } from "../Records";
import { money } from "../../lib/format";
import { requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { ErrorNote, Form, Modal, Tabs, callRpc, dateOf, dayRange, label, useAction, useLoad } from "../suite";

type Summary = { received: number; outstanding: number; sales: number; paid_out: number; by_method: { method: string; amount: number }[] };
type Received = { sale_id: string; receipt_number: string; customer_name: string; total_amount: number; amount_paid: number; outstanding: number; payment_method: string | null; sold_at: string };
type Balance = { supplier_id: string; supplier_name: string; earned: number; paid: number; balance: number; verified: boolean; last_paid: string | null };
type Payout = { id: string; amount: number; method: string; reference: string | null; note: string | null; paid_at: string; suppliers: { name: string } | null };
type Tab = "received" | "balances" | "history";

export default function Payments() {
  const { can, search, notify } = useAdmin();
  const [tab, setTab] = useState<Tab>("received");
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
  const s = search.toLowerCase();
  const owed = (bal.data ?? []).reduce((a, b) => a + Number(b.balance), 0);
  const canPay = can("payments.manage");
  const refreshAll = () => { sum.reload(); bal.reload(); his.reload(); };

  return (
    <>
      <PageHeading title="Payments & Payouts" sub="Money received from customers and money paid out to suppliers." action={
        <select className="status-select info" aria-label="Period" value={days} onChange={e => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
        </select>} />
      <ErrorNote text={sum.error} />
      <SummaryStrip items={[
        { icon: <ArrowDownToLine />, tone: "mint", value: money(Number(sum.data?.received ?? 0)), label: "Received" },
        { icon: <Clock />, tone: "gold", value: money(Number(sum.data?.outstanding ?? 0)), label: "Still owed by customers" },
        { icon: <ArrowUpFromLine />, tone: "blue", value: money(Number(sum.data?.paid_out ?? 0)), label: "Paid to suppliers" },
        { icon: <HandCoins />, tone: "red", value: money(owed), label: "Owed to suppliers" },
      ]} />
      {(sum.data?.by_method?.length ?? 0) > 0 && (
        <div className="su-row" style={{ margin: "0 0 14px" }}>
          {sum.data!.by_method.map(m => <StatusChip key={m.method} tone="info" icon={<Banknote size={14} />}>{label(m.method)} · {money(Number(m.amount))}</StatusChip>)}
        </div>
      )}
      <Tabs label="Payments views" value={tab} onChange={setTab} tabs={[
        { id: "received", label: "Received", icon: <Receipt /> },
        { id: "balances", label: "Supplier balances", icon: <Wallet />, count: (bal.data ?? []).filter(b => Number(b.balance) > 0).length },
        { id: "history", label: "Payout history", icon: <HandCoins /> },
      ]} />

      {tab === "received" && <>
        <ErrorNote text={rec.error} />
        <DataTable headers={["Receipt", "Customer", "Method", "Total", "Paid", "Owed", "Date"]} isEmpty={!(rec.data ?? []).length} empty={rec.loading ? "Loading…" : "No payments in this period."}>
          {(rec.data ?? []).filter(r => `${r.receipt_number} ${r.customer_name}`.toLowerCase().includes(s)).map(r => (
            <tr key={r.sale_id}><td><span className="docno">{r.receipt_number}</span></td><td>{r.customer_name}</td><td>{r.payment_method ? label(r.payment_method) : "—"}</td>
              <td>{money(Number(r.total_amount))}</td><td>{money(Number(r.amount_paid))}</td>
              <td>{Number(r.outstanding) > 0 ? <span className="status warn">{money(Number(r.outstanding))}</span> : <span className="status good">Paid</span>}</td><td>{dateOf(r.sold_at)}</td></tr>
          ))}
        </DataTable>
      </>}

      {tab === "balances" && <>
        <ErrorNote text={bal.error} />
        <div className="info-banner"><Wallet /> A supplier earns the supplier price minus TradeLink's commission on each sale. Suppliers must be verified before they can be paid.</div>
        <DataTable headers={["Supplier", "Earned", "Paid", "Balance", "Verified", "Last payout", "Actions"]} isEmpty={!(bal.data ?? []).length} empty={bal.loading ? "Loading…" : "No supplier sales yet, so nothing is owed."}>
          {(bal.data ?? []).filter(b => b.supplier_name.toLowerCase().includes(s)).map(b => (
            <tr key={b.supplier_id}><td><b>{b.supplier_name}</b></td><td>{money(Number(b.earned))}</td><td>{money(Number(b.paid))}</td><td><b>{money(Number(b.balance))}</b></td>
              <td>{b.verified ? <span className="status good">Verified</span> : <span className="status warn">Not verified</span>}</td><td>{dateOf(b.last_paid)}</td>
              <td>{canPay && Number(b.balance) > 0 && <button className="btn green" onClick={() => b.verified ? setPay(b) : notify("Verify this supplier first, in Supplier Verification.")}>Pay</button>}</td></tr>
          ))}
        </DataTable>
      </>}

      {tab === "history" && <>
        <ErrorNote text={his.error} />
        <DataTable headers={["Date", "Supplier", "Amount", "Method", "Reference", "Note"]} isEmpty={!(his.data ?? []).length} empty={his.loading ? "Loading…" : "No payouts recorded yet."}>
          {(his.data ?? []).filter(p => `${p.suppliers?.name ?? ""} ${p.reference ?? ""}`.toLowerCase().includes(s)).map(p => (
            <tr key={p.id}><td>{dateOf(p.paid_at)}</td><td>{p.suppliers?.name ?? "—"}</td><td><b>{money(Number(p.amount))}</b></td><td>{label(p.method)}</td><td>{p.reference || "—"}</td><td>{p.note || "—"}</td></tr>
          ))}
        </DataTable>
      </>}

      {pay && <PayModal b={pay} onClose={() => setPay(null)} onDone={() => { setPay(null); refreshAll(); }} />}
    </>
  );
}

function PayModal({ b, onClose, onDone }: { b: Balance; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(String(Number(b.balance)));
  const [method, setMethod] = useState("bank_transfer");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const submit = async () => {
    const ok = await run(() => callRpc("record_payout", { p_supplier: b.supplier_id, p_amount: Number(amount), p_method: method, p_reference: ref, p_note: note }), "Payout recorded.");
    if (ok) onDone();
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
