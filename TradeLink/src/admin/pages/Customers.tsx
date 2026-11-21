import { useMemo } from "react";
import { Clock, MapPin, MessagesSquare, Phone, Users } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconBtn, RecCard, RecordList, ago, initialsOf } from "../Records";
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
      <RecordList isEmpty={!rows.length} empty="No customers yet" icon={<Users />}>
        {rows.map((c, i) => (
          <RecCard key={c.phone} i={i} tone="info" initials={initialsOf(c.name)} title={c.name} sub={c.phone}
            facts={[{ icon: <MapPin size={14} />, text: c.location, tone: "place" }, { icon: <MessagesSquare size={14} />, text: String(c.count) }, { icon: <Clock size={14} />, text: ago(c.last), tone: "time" }]}
            actions={<IconBtn primary tone="green" icon={<Phone size={17} />} label="Call" href={`tel:${c.phone.replace(/[^\d+]/g, "")}`} />}
            details={[["Email", c.email || "—"], ["First", shortDate(c.first)], ["Latest", shortDate(c.last)]]} />
        ))}
      </RecordList>
    </>
  );
}
