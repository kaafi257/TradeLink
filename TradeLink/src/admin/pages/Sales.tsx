import { DataTable, PageHeading } from "../../components/ui";
import { money, shortDate } from "../../lib/format";
import { useAdmin } from "../AdminData";

export default function SalesPage() {
  const { sales, search } = useAdmin();
  const s = search.toLowerCase();
  const rows = sales.filter(x => `${x.receipt_number} ${x.customer_name}`.toLowerCase().includes(s)).slice(0, 200);
  return (
    <>
      <PageHeading title="Sales & Deliveries" sub="Recorded sales for this year (latest 200 shown). Delivery tracking is not built yet." />
      <DataTable headers={["Receipt", "Customer", "Total", "Paid", "Method", "Date"]} isEmpty={!rows.length} empty="No sales have been recorded yet.">
        {rows.map(x => (
          <tr key={x.id}><td><b>{x.receipt_number}</b></td><td>{x.customer_name}</td><td>{money(Number(x.total_amount))}</td><td>{money(Number(x.amount_paid))}</td><td>{x.payment_method || "—"}</td><td>{shortDate(x.sold_at)}</td></tr>
        ))}
      </DataTable>
    </>
  );
}
