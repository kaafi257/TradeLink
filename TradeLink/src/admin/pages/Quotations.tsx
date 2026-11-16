import { useState } from "react";
import { Clock, FileText, Inbox, MapPin, Package, ShoppingCart, Sparkles, Tag, User } from "lucide-react";
import { PageHeading, SummaryStrip } from "../../components/ui";
import { IconBtn, RecCard, RecordList, ago, type Tone } from "../Records";
import { money, shortDate } from "../../lib/format";
import { errorText, requireSupabase, type Quote } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { PriceQuoteModal } from "../workflowModals";

// "quoted" and "converted" are set by pricing a quote / creating an order, never by hand.
const MANUAL = ["new", "reviewing", "accepted", "rejected"];
const QTONE: Record<string, Tone> = { new: "warn", reviewing: "info", quoted: "info", accepted: "good", rejected: "bad", converted: "good" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const describe = (q: Quote) => q.quotation_items?.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(", ") || q.notes || "—";

export default function Quotations() {
  const { quotes, quoteCount, newQuoteCount, search, notify, reload, can } = useAdmin();
  const [pricing, setPricing] = useState<Quote | null>(null);
  const [busyId, setBusyId] = useState("");
  const s = search.toLowerCase();
  const rows = quotes.filter(q => `${q.quote_number} ${q.customer_name} ${q.phone} ${q.delivery_location}`.toLowerCase().includes(s));

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
    <>
      <PageHeading title="Quotations" sub="Review customer enquiries, price them, then turn accepted quotes into orders." />
      <SummaryStrip items={[
        { icon: <Inbox />, tone: "blue", value: quoteCount, label: "All" },
        { icon: <Sparkles />, tone: "gold", value: newQuoteCount, label: "New" },
        { icon: <FileText />, tone: "mint", value: quotes.filter(q => q.status === "quoted").length, label: "Quoted" },
        { icon: <ShoppingCart />, tone: "mint", value: quotes.filter(q => q.status === "converted").length, label: "Orders" },
      ]} />
      <RecordList isEmpty={!rows.length} empty="No quotations" icon={<FileText />}>
        {rows.map((q, i) => {
          const open = ["new", "reviewing", "quoted"].includes(q.status);
          const locked = q.status === "converted";
          const n = q.quotation_items?.length ?? 0;
          const total = Number(q.estimated_total);
          return (
            <RecCard key={q.id} i={i} tone={QTONE[q.status] ?? "info"} lead={q.customer_type === "individual" ? <User size={22} /> : <FileText size={22} />}
              title={<span className="docno">{q.quote_number || q.id.slice(0, 8)}</span>} sub={q.customer_name}
              facts={[{ icon: <Package size={14} />, text: n ? `${n} ${n === 1 ? "item" : "items"}` : "" }, { icon: <MapPin size={14} />, text: q.delivery_location }, { icon: <Clock size={14} />, text: ago(q.created_at) }]}
              control={
                <select className={`status-select ${QTONE[q.status] ?? "info"}`} aria-label={`Status of ${q.quote_number}`} value={q.status} disabled={locked || busyId === q.id} onChange={e => void setStatus(q, e.target.value)}>
                  {!MANUAL.includes(q.status) && <option value={q.status} disabled>{cap(q.status)}</option>}
                  {MANUAL.map(st => <option key={st} value={st}>{cap(st)}</option>)}
                </select>}
              amount={total > 0 ? money(total) : "—"}
              actions={<>
                {open && can("quotes.price") && <IconBtn primary tone="gold" icon={<Tag size={18} />} label={q.status === "quoted" ? "Re-price" : "Price"} onClick={() => setPricing(q)} />}
                {["quoted", "accepted"].includes(q.status) && total > 0 && can("quotes.convert") && <IconBtn primary tone="green" icon={<ShoppingCart size={18} />} label="Order" disabled={busyId === q.id} onClick={() => void createOrder(q)} />}
              </>}
              details={[["Phone", q.phone], ["Request", describe(q)], ["Address", q.delivery_location], ["Received", shortDate(q.created_at)]]} />
          );
        })}
      </RecordList>
      {pricing && <PriceQuoteModal quote={pricing} onClose={() => setPricing(null)} />}
    </>
  );
}
