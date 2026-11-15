import { useState } from "react";
import { DataTable, PageHeading } from "../../components/ui";
import { money, shortDate } from "../../lib/format";
import { errorText, requireSupabase, type Quote } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { PriceQuoteModal } from "../workflowModals";

// "quoted" and "converted" are set by pricing a quote / creating an order, never by hand.
const MANUAL = ["new", "reviewing", "accepted", "rejected"];
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
      <div className="summary-strip">
        <div><b>{quoteCount}</b><small>Total enquiries</small></div>
        <div><b>{newQuoteCount}</b><small>New enquiries</small></div>
        <div><b>{quotes.filter(q => q.status === "quoted").length}</b><small>Quoted (latest 200)</small></div>
        <div><b>{quotes.filter(q => q.status === "converted").length}</b><small>Converted to orders (latest 200)</small></div>
      </div>
      <DataTable headers={["Reference", "Customer", "Phone", "Request", "Delivery location", "Received", "Total", "Status", "Actions"]} isEmpty={!rows.length} empty="No customer quotations match.">
        {rows.map(q => {
          const open = ["new", "reviewing", "quoted"].includes(q.status);
          const locked = q.status === "converted";
          return (
            <tr key={q.id}>
              <td><b>{q.quote_number || q.id.slice(0, 8)}</b></td><td>{q.customer_name}{q.customer_type === "individual" && <> <span className="status muted">retail</span></>}</td><td>{q.phone}</td>
              <td>{describe(q)}</td><td>{q.delivery_location}</td><td>{shortDate(q.created_at)}</td>
              <td>{Number(q.estimated_total) > 0 ? money(Number(q.estimated_total)) : "—"}</td>
              <td>
                <select aria-label={`Status of ${q.quote_number}`} value={q.status} disabled={locked || busyId === q.id} onChange={e => void setStatus(q, e.target.value)}>
                  {!MANUAL.includes(q.status) && <option value={q.status} disabled>{cap(q.status)}</option>}
                  {MANUAL.map(st => <option key={st} value={st}>{cap(st)}</option>)}
                </select>
              </td>
              <td>
                {open && can("quotes.price") && <button className="btn outline" onClick={() => setPricing(q)}>{q.status === "quoted" ? "Re-price" : "Price"}</button>}{" "}
                {["quoted", "accepted"].includes(q.status) && Number(q.estimated_total) > 0 && can("quotes.convert") &&
                  <button className="btn green" disabled={busyId === q.id} onClick={() => void createOrder(q)}>Create order</button>}
              </td>
            </tr>
          );
        })}
      </DataTable>
      {pricing && <PriceQuoteModal quote={pricing} onClose={() => setPricing(null)} />}
    </>
  );
}
