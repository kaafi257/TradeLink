import { useState } from "react";
import { Ban, CheckCircle2, ClipboardCheck, Clock, MapPin, Package, PackageCheck, Receipt, ShoppingCart, Truck, X } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeading, SummaryStrip } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip, type Tone } from "../Records";
import { money, shortDate } from "../../lib/format";
import { errorText, requireSupabase, type OrderRow } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { AssignModal, SaleModal } from "../workflowModals";

const STATUS: Record<string, { label: string; icon: ReactNode; tone: Tone }> = {
  confirmed: { label: "To sell", icon: <ClipboardCheck size={14} />, tone: "warn" },
  ready: { label: "Ready", icon: <PackageCheck size={14} />, tone: "info" },
  dispatched: { label: "On the way", icon: <Truck size={14} />, tone: "info" },
  completed: { label: "Done", icon: <CheckCircle2 size={14} />, tone: "good" },
  cancelled: { label: "Cancelled", icon: <Ban size={14} />, tone: "muted" },
};

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
      <SummaryStrip items={[
        { icon: <ClipboardCheck />, tone: "gold", value: orders.filter(o => o.status === "confirmed").length, label: "To sell" },
        { icon: <PackageCheck />, tone: "blue", value: orders.filter(o => o.status === "ready").length, label: "Ready" },
        { icon: <Truck />, tone: "mint", value: orders.filter(o => o.status === "dispatched").length, label: "On the way" },
        { icon: <CheckCircle2 />, tone: "mint", value: orders.filter(o => o.status === "completed").length, label: "Done" },
      ]} />
      <RecordList isEmpty={!rows.length} empty="No orders yet" icon={<ShoppingCart />}>
        {rows.map((o, i) => {
          const hasDelivery = deliveries.some(d => d.order_id === o.id && d.status !== "failed");
          const items = o.order_items ?? [];
          const total = Number(o.total_amount), paid = Number(o.amount_paid);
          const st = STATUS[o.status] ?? { label: o.status, icon: <Clock size={14} />, tone: "warn" as Tone };
          return (
            <RecCard key={o.id} i={i} tone={st.tone} lead={<ShoppingCart size={22} />} title={<span className="docno">{o.order_number}</span>} sub={o.customer_name}
              facts={[{ icon: <Package size={14} />, text: items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : "" }, { icon: <MapPin size={14} />, text: o.delivery_location }]}
              amount={money(total)} meter={total > 0 ? paid / total : 0}
              status={<StatusChip tone={st.tone} icon={st.icon} pulse={o.status === "confirmed" || o.status === "ready"}>{st.label}</StatusChip>}
              actions={<>
                {o.status === "confirmed" && can("sales.record") && <IconBtn primary tone="green" icon={<Receipt size={18} />} label="Sell" onClick={() => setSale(o)} />}
                {o.status === "confirmed" && can("orders.cancel") && <IconBtn tone="red" icon={<X size={18} />} label="Cancel order" onClick={() => void cancel(o)} />}
                {o.status === "ready" && !hasDelivery && can("deliveries.assign") && <IconBtn primary tone="gold" icon={<Truck size={18} />} label="Deliver" onClick={() => setAssign(o)} />}
              </>}
              details={[["Phone", o.phone], ["Items", items.map(it => `${it.quantity} ${it.unit} ${it.product_name}`).join(", ") || "—"], ["Paid", money(paid)], ["Date", shortDate(o.created_at)], ["Address", o.delivery_location]]} />
          );
        })}
      </RecordList>
      {sale && <SaleModal order={sale} onClose={() => setSale(null)} />}
      {assign && <AssignModal order={assign} onClose={() => setAssign(null)} />}
    </>
  );
}
