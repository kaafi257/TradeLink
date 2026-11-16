import { useState } from "react";
import { DataTable, PageHeading } from "../../components/ui";
import { money, shortDate } from "../../lib/format";
import { errorText, requireSupabase, type OrderRow } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { AssignModal, SaleModal } from "../workflowModals";

const tone = (s: string) => (s === "completed" ? "good" : s === "cancelled" ? "muted" : "warn");

export default function Orders() {
  const { orders, deliveries, search, can, notify, reload } = useAdmin();
  const [sale, setSale] = useState<OrderRow | null>(null);
  const [assign, setAssign] = useState<OrderRow | null>(null);
  const s = search.toLowerCase();
  const rows = orders.filter(o => `${o.order_number} ${o.customer_name} ${o.phone} ${o.delivery_location}`.toLowerCase().includes(s));

  const cancel = async (o: OrderRow) => {
    if (!window.confirm(`Cancel order ${o.order_number}? This cannot be undone.`)) return;
    try {
      const { error } = await requireSupabase().rpc("cancel_order", { p_order: o.id });
      if (error) throw error;
      notify("Order cancelled.");
      await reload();
    } catch (e) { notify(errorText(e, "Could not cancel the order")); }
  };

  return (
    <>
      <PageHeading title="Orders" sub="Confirmed orders move through: record sale (stock is deducted) → assign delivery → delivered." />
      <div className="summary-strip">
        <div><b>{orders.filter(o => o.status === "confirmed").length}</b><small>Awaiting sale</small></div>
        <div><b>{orders.filter(o => o.status === "ready").length}</b><small>Ready for delivery</small></div>
        <div><b>{orders.filter(o => o.status === "dispatched").length}</b><small>Out for delivery</small></div>
        <div><b>{orders.filter(o => o.status === "completed").length}</b><small>Completed</small></div>
      </div>
      <DataTable headers={["Order", "Customer", "Items", "Delivery location", "Total", "Paid", "Date", "Status", "Actions"]} isEmpty={!rows.length} empty="No orders yet. Create one from a priced quotation.">
        {rows.map(o => {
          const hasDelivery = deliveries.some(d => d.order_id === o.id && d.status !== "failed");
          return (
            <tr key={o.id}>
              <td><b className="docno">{o.order_number}</b></td><td>{o.customer_name}<br /><small>{o.phone}</small></td>
              <td>{o.order_items?.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(", ") || "—"}</td>
              <td>{o.delivery_location}</td><td>{money(Number(o.total_amount))}</td><td>{money(Number(o.amount_paid))}</td><td>{shortDate(o.created_at)}</td>
              <td><span className={`status ${tone(o.status)}`}>{o.status}</span></td>
              <td>
                {o.status === "confirmed" && can("sales.record") && <button className="btn green" onClick={() => setSale(o)}>Record sale</button>}{" "}
                {o.status === "confirmed" && can("orders.cancel") && <button className="btn outline" onClick={() => void cancel(o)}>Cancel</button>}
                {o.status === "ready" && !hasDelivery && can("deliveries.assign") && <button className="btn gold" onClick={() => setAssign(o)}>Assign delivery</button>}
              </td>
            </tr>
          );
        })}
      </DataTable>
      {sale && <SaleModal order={sale} onClose={() => setSale(null)} />}
      {assign && <AssignModal order={assign} onClose={() => setAssign(null)} />}
    </>
  );
}
