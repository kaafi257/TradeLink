import { useState } from "react";
import { ArrowUpFromLine, Inbox, Receipt } from "lucide-react";
import { requireSupabase } from "../../lib/supabase";
import PayoutReceipt, { payoutNo, type PayoutRec } from "../../components/PayoutReceipt";
import { useSupplier } from "./context";
import { Spinner, dateOf, money, useLoad } from "./ops";

type Row = { id: string; amount: number; method: string; reference: string | null; note: string | null; paid_at: string };
const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", mobile_money: "Mobile money", cash: "Cash" };

/** Money TradeLink has paid to this supplier. Rows are visible to this supplier only (row-level security). */
export default function Payments() {
  const { supplier } = useSupplier();
  const [rc, setRc] = useState<PayoutRec | null>(null);
  const { data, error, loading } = useLoad(async () => {
    const db = requireSupabase();
    const [p, e] = await Promise.all([
      db.from("supplier_payouts").select("id, amount, method, reference, note, paid_at").order("paid_at", { ascending: false }).limit(300),
      db.from("sale_commissions").select("supplier_earning").limit(20000),
    ]);
    if (p.error) throw p.error;
    const rows = (p.data ?? []) as Row[];
    const earned = e.error ? null : ((e.data ?? []) as { supplier_earning: number }[]).reduce((a, r) => a + Number(r.supplier_earning), 0);
    const paid = rows.reduce((a, r) => a + Number(r.amount), 0);
    return { rows, paid, earned };
  });
  if (loading) return <Spinner />;
  if (!data) return <p className="sp-note err" role="alert">{error}</p>;
  const owed = data.earned == null ? null : Math.max(0, data.earned - data.paid);
  return (
    <div className="sp-dash">
      <section className="dh">
        <div className="dh-top"><small>Payments from TradeLink</small><h2>{money(data.paid)}</h2></div>
        <div className="dh-kpis">
          {data.earned != null && <div><small>Total earned</small><b>{money(data.earned)}</b><em>After TradeLink commission</em></div>}
          {owed != null && <div><small>Still to be paid</small><b>{money(owed)}</b><em>{owed > 0 ? "TradeLink pays after verification" : "Nothing owed"}</em></div>}
          <div><small>Payments received</small><b>{data.rows.length}</b><em>Each has a receipt</em></div>
        </div>
      </section>
      <section className="sp-card"><div className="sp-card-head"><h3>Payment history</h3></div>
        {data.rows.length === 0 ? <p className="sp-empty small"><Inbox size={20} /> No payments yet. When TradeLink pays you, it appears here with a receipt.</p> : (
          <ul className="sp-rows pay">{data.rows.map(r => (
            <li key={r.id}><div className="pay-row">
              <span className="pay-ic"><ArrowUpFromLine size={18} /></span>
              <span className="pay-main"><b>{money(r.amount)}</b><small>{payoutNo(r.id)} · {dateOf(r.paid_at)} · {METHOD[r.method] ?? r.method}{r.reference ? ` · ${r.reference}` : ""}</small></span>
              <button className="sp-btn line sm" onClick={() => setRc({ ...r, amount: Number(r.amount), supplier_name: supplier?.name ?? "Supplier" })}><Receipt size={15} /> Receipt</button>
            </div></li>))}
          </ul>)}
      </section>
      {rc && <PayoutReceipt r={rc} onClose={() => setRc(null)} />}
    </div>
  );
}
