import { useState } from "react";
import { ChevronDown, FileText, ShoppingCart, Tag } from "lucide-react";
import { ago } from "../Records";
import { money, shortDate } from "../../lib/format";
import { errorText, requireSupabase, type Quote } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { PriceQuoteModal } from "../workflowModals";
import "./orders.css";

// "quoted" and "converted" are set by pricing a quote / creating an order, never by hand.
const MANUAL = ["new", "reviewing", "accepted", "rejected"];
const TONE: Record<string, string> = { new: "sky", reviewing: "indigo", quoted: "teal", accepted: "green", rejected: "red", converted: "green" };
const TABS: [string, string][] = [["all", "All"], ["new", "New"], ["reviewing", "Reviewing"], ["quoted", "Quoted"], ["accepted", "Accepted"], ["converted", "Ordered"], ["rejected", "Rejected"]];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const initials = (n: string) => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const describe = (q: Quote) => q.quotation_items?.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(", ") || q.notes || "—";

export default function Quotations() {
  const { quotes, search, notify, reload, can } = useAdmin();
  const [pricing, setPricing] = useState<Quote | null>(null);
  const [busyId, setBusyId] = useState("");
  const s = search.toLowerCase();
  const count = (k: string) => (k === "all" ? quotes.length : quotes.filter(q => q.status === k).length);
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = quotes.filter(q => (tab === "all" || q.status === tab) && `${q.quote_number} ${q.customer_name} ${q.phone} ${q.delivery_location}`.toLowerCase().includes(s));

  const call = async (id: string, run: () => PromiseLike<{ error: unknown }>, done: string) => {
    setBusyId(id);
    try {
      const { error } = await run();
      if (error) throw error;
      notify(done);
      await reload();
    } catch (e) { notify(errorText(e, "Update failed")); }
    finally { setBusyId(""); }
  };
  const setStatus = (q: Quote, status: string) => call(q.id, () => requireSupabase().from("quotations").update({ status }).eq("id", q.id), "Quotation updated.");
  const createOrder = (q: Quote) => call(q.id, () => requireSupabase().rpc("convert_quote_to_order", { p_quote: q.id }), "Order created. Find it under Orders.");

  return (
    <div className="ord qt">
      <header className="ord-h"><h1>Quotations</h1><p>Review customer enquiries, price them, then turn accepted quotes into orders.</p></header>
      <nav className="ord-tabs" aria-label="Quotation status">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}<span>{count(k)}</span></button>)}
      </nav>
      {rows.length === 0 ? (
        <div className="ord-empty"><FileText size={26} /><b>{quotes.length ? "No quotations match" : "No quotations yet"}</b></div>
      ) : (
        <div className="ord-table" role="table" aria-label="Quotations">
          <div className="ord-row head" role="row"><span>Quote</span><span>Customer</span><span>Received</span><span className="r">Estimate</span><span>Status</span><span /></div>
          {rows.map(q => {
            const open = ["new", "reviewing", "quoted"].includes(q.status);
            const locked = q.status === "converted";
            const n = q.quotation_items?.length ?? 0;
            const total = Number(q.estimated_total);
            const isOpen = openId === q.id;
            const no = q.quote_number || q.id.slice(0, 8);
            const canPrice = open && can("quotes.price");
            const canOrder = ["quoted", "accepted"].includes(q.status) && total > 0 && can("quotes.convert");
            return (
              <div key={q.id} className={`ord-item${isOpen ? " open" : ""}`} role="rowgroup">
                <div className="ord-row" role="row">
                  <button className="ord-no" onClick={() => setOpenId(isOpen ? null : q.id)} aria-expanded={isOpen} aria-label={`Details of ${no}`}><ChevronDown size={15} />{no}</button>
                  <span className="ord-cu who"><i className="ord-av">{initials(q.customer_name)}</i><span><b>{q.customer_name}</b><small>{[n ? `${n} ${n === 1 ? "item" : "items"}` : "", q.delivery_location].filter(Boolean).join(" · ")}</small></span></span>
                  <span className="ord-dt">{ago(q.created_at)}</span>
                  <span className="ord-am r"><b>{total > 0 ? money(total) : "—"}</b></span>
                  <span className="ord-ss">
                    <select className={`ord-sel ${TONE[q.status] ?? "grey"}`} aria-label={`Status of ${no}`} value={q.status} disabled={locked || busyId === q.id} onChange={e => void setStatus(q, e.target.value)}>
                      {!MANUAL.includes(q.status) && <option value={q.status} disabled>{cap(q.status)}</option>}
                      {MANUAL.map(st => <option key={st} value={st}>{cap(st)}</option>)}
                    </select>
                  </span>
                  <span className="ord-ac">
                    {canPrice && <button className="ord-b main" onClick={() => setPricing(q)}><Tag size={14} />{q.status === "quoted" ? "Re-price" : "Price"}</button>}
                    {canOrder && <button className="ord-b main" disabled={busyId === q.id} onClick={() => void createOrder(q)}><ShoppingCart size={14} />Create order</button>}
                  </span>
                </div>
                {isOpen && (
                  <dl className="ord-more">
                    <div><dt>Phone</dt><dd>{q.phone || "—"}</dd></div>
                    <div><dt>Address</dt><dd>{q.delivery_location || "—"}</dd></div>
                    <div><dt>Received</dt><dd>{shortDate(q.created_at)}</dd></div>
                    {q.coupon_code && <div><dt>Coupon</dt><dd>{q.coupon_code} · {Number(q.discount_percent)}% off</dd></div>}
                    <div className="wide"><dt>Request</dt><dd>{describe(q)}</dd></div>
                  </dl>)}
              </div>);
          })}
        </div>)}
      {pricing && <PriceQuoteModal quote={pricing} onClose={() => setPricing(null)} />}
    </div>
  );
}
