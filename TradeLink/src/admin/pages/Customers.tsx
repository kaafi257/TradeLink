import { useMemo } from "react";
import { DataTable, PageHeading } from "../../components/ui";
import { shortDate } from "../../lib/format";
import { useAdmin } from "../AdminData";

export default function Customers() {
  const { quotes, search } = useAdmin();
  // One row per phone number, built from quotation enquiries (newest first in `quotes`).
  const customers = useMemo(() => {
    const map = new Map<string, { name: string; phone: string; email: string | null; location: string; first: string; last: string; count: number }>();
    for (const q of quotes) {
      const c = map.get(q.phone);
      if (!c) map.set(q.phone, { name: q.customer_name, phone: q.phone, email: q.email, location: q.delivery_location, first: q.created_at, last: q.created_at, count: 1 });
      else { c.count += 1; c.first = q.created_at; c.email = c.email || q.email; }
    }
    return [...map.values()];
  }, [quotes]);
  const s = search.toLowerCase();
  const rows = customers.filter(c => `${c.name} ${c.phone} ${c.location}`.toLowerCase().includes(s));

  return (
    <>
      <PageHeading title="Customers" sub="Customer directory built from wholesale quotation enquiries (latest 200)." />
      <DataTable headers={["Customer", "Phone", "Email", "Delivery location", "Enquiries", "First enquiry", "Latest enquiry"]} isEmpty={!rows.length} empty="Customers will appear when they submit wholesale enquiries.">
        {rows.map(c => (
          <tr key={c.phone}><td><b>{c.name}</b></td><td>{c.phone}</td><td>{c.email || "—"}</td><td>{c.location}</td><td>{c.count}</td><td>{shortDate(c.first)}</td><td>{shortDate(c.last)}</td></tr>
        ))}
      </DataTable>
    </>
  );
}
