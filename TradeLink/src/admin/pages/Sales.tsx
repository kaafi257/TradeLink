import { Check, Clock, CreditCard, Receipt } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { RecCard, RecordList, StatusChip, ago } from "../Records";
import { money, shortDate } from "../../lib/format";
import { useAdmin } from "../AdminData";

export default function SalesPage() {
  const { sales, search } = useAdmin();
  const s = search.toLowerCase();
  const rows = sales.filter(x => `${x.receipt_number} ${x.customer_name}`.toLowerCase().includes(s)).slice(0, 200);
  return (
    <>
      <PageHeading title="Sales & Deliveries" sub="The 200 most recent sales. Record a sale from the Orders page: it deducts stock and cannot be edited afterwards." />
      <RecordList isEmpty={!rows.length} empty="No sales yet" icon={<Receipt />}>
        {rows.map((x, i) => {
          const total = Number(x.total_amount), paid = Number(x.amount_paid);
          const full = paid >= total;
          return (
            <RecCard key={x.id} i={i} tone={full ? "good" : "warn"} lead={<Receipt size={22} />} title={<span className="docno">{x.receipt_number}</span>} sub={x.customer_name}
              facts={[{ icon: <CreditCard size={14} />, text: x.payment_method || "" }, { icon: <Clock size={14} />, text: ago(x.sold_at) }]}
              amount={money(total)} meter={total > 0 ? paid / total : 0}
              status={<StatusChip tone={full ? "good" : "warn"} icon={full ? <Check size={14} /> : <Clock size={14} />}>{full ? "Paid" : "Part"}</StatusChip>}
              details={[["Paid", money(paid)], ["Date", shortDate(x.sold_at)]]} />
          );
        })}
      </RecordList>
    </>
  );
}
