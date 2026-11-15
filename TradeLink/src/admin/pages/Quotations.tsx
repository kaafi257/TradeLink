import { DataTable, PageHeading } from "../../components/ui";
import { shortDate } from "../../lib/format";
import { requireSupabase, type Quote } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const STATUSES = ["new", "reviewing", "quoted", "accepted", "rejected", "converted"];
const describe = (q: Quote) => q.quotation_items?.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(", ") || q.notes || "—";

export default function Quotations() {
  const { quotes, quoteCount, newQuoteCount, search, notify, reload } = useAdmin();
  const s = search.toLowerCase();
  const rows = quotes.filter(q => `${q.quote_number} ${q.customer_name} ${q.phone} ${q.delivery_location}`.toLowerCase().includes(s));

  const update = async (q: Quote, status: string) => {
    try {
      const { error } = await requireSupabase().from("quotations").update({ status }).eq("id", q.id);
      if (error) throw error;
      notify("Quotation updated.");
      await reload();
    } catch (e) { notify(e instanceof Error ? e.message : "Update failed"); }
  };

  return (
    <>
      <PageHeading title="Orders & Quotations" sub="Review customer enquiries and manage wholesale quotations." />
      <div className="summary-strip">
        <div><b>{quoteCount}</b><small>Total enquiries</small></div>
        <div><b>{newQuoteCount}</b><small>New enquiries</small></div>
        <div><b>{quotes.filter(q => q.status === "quoted").length}</b><small>Quoted (latest 200)</small></div>
        <div><b>{quotes.filter(q => q.status === "accepted").length}</b><small>Accepted (latest 200)</small></div>
      </div>
      <DataTable headers={["Reference", "Customer", "Phone", "Request", "Delivery location", "Received", "Status", "Update"]} isEmpty={!rows.length} empty="No customer quotations match.">
        {rows.map(q => (
          <tr key={q.id}>
            <td><b>{q.quote_number || q.id.slice(0, 8)}</b></td><td>{q.customer_name}</td><td>{q.phone}</td>
            <td>{describe(q)}</td><td>{q.delivery_location}</td><td>{shortDate(q.created_at)}</td>
            <td><span className={`status ${q.status === "accepted" ? "good" : q.status === "new" ? "warn" : "muted"}`}>{q.status}</span></td>
            <td><select aria-label={`Status of ${q.quote_number}`} value={q.status} onChange={e => void update(q, e.target.value)}>{STATUSES.map(st => <option key={st} value={st}>{st[0].toUpperCase() + st.slice(1)}</option>)}</select></td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
