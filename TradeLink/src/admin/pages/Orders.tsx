import { useState } from "react";
import { ChevronDown, Search, ShoppingCart } from "lucide-react";
import { money, shortDate } from "../../lib/format";
import { errorText, requireSupabase, type OrderRow } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import { AssignModal, SaleModal } from "../workflowModals";
import "./orders.css";

const STATUS: Record<string, { label: string; dot: string }> = {
  pending: { label: "Pending", dot: "grey" },
  confirmed: { label: "To sell", dot: "sky" },
  ready: { label: "Ready", dot: "teal" },
  dispatched: { label: "On the way", dot: "indigo" },
  completed: { label: "Done", dot: "green" },
  cancelled: { label: "Cancelled", dot: "grey" },
};
const initials = (n: string) => (n || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase();
const TABS: [string, string][] = [["all", "All"], ["confirmed", "To sell"], ["ready", "Ready"], ["dispatched", "On the way"], ["completed", "Done"], ["cancelled", "Cancelled"]];

export default function Orders() {
  const { orders, deliveries, search, can, notify, reload } = useAdmin();
  const [sale, setSale] = useState<OrderRow | null>(null);
  const [assign, setAssign] = useState<OrderRow | null>(null);
  const [tab, setTab] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const s = search.toLowerCase();
  const count = (k: string) => (k === "all" ? orders.length : orders.filter(o => o.status === k).length);
  const rows = orders.filter(o => (tab === "all" || o.status === tab) && `${o.order_number} ${o.customer_name} ${o.phone} ${o.delivery_location}`.toLowerCase().includes(s));

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
    <div className="ord">
      <header className="ord-h"><h1>Orders</h1><p>Record the sale, assign a delivery, then it is delivered.</p></header>
      <nav className="ord-tabs" aria-label="Order status">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? "on" : ""} aria-pressed={tab === k} onClick={() => setTab(k)}>{label}<span>{count(k)}</span></button>)}
      </nav>
      {rows.length === 0 ? (
        <div className="ord-empty"><ShoppingCart size={26} /><b>{orders.length ? "No orders match" : "No orders yet"}</b>{search && <small><Search size={13} /> Search: {search}</small>}</div>
      ) : (
        <div className="ord-table" role="table" aria-label="Orders">
          <div className="ord-row head" role="row"><span>Order</span><span>Customer</span><span>Date</span><span className="r">Total</span><span>Status</span><span /></div>
          {rows.map(o => {
            const hasDelivery = deliveries.some(d => d.order_id === o.id && d.status !== "failed");
            const items = o.order_items ?? [];
            const total = Number(o.total_amount), paid = Number(o.amount_paid), due = Math.max(0, total - paid);
            const st = STATUS[o.status] ?? { label: o.status, dot: "grey" };
            const isOpen = open === o.id;
            const canSell = o.status === "confirmed" && can("sales.record");
            const canCancel = o.status === "confirmed" && can("orders.cancel");
            const canDeliver = o.status === "ready" && !hasDelivery && can("deliveries.assign");
            return (
              <div key={o.id} className={`ord-item${isOpen ? " open" : ""}`} role="rowgroup">
                <div className="ord-row" role="row">
                  <button className="ord-no" onClick={() => setOpen(isOpen ? null : o.id)} aria-expanded={isOpen} aria-label={`Details of ${o.order_number}`}><ChevronDown size={15} />{o.order_number}</button>
                  <span className="ord-cu who"><i className="ord-av">{initials(o.customer_name)}</i><span><b>{o.customer_name}</b><small>{[items.length ? `${items.length} ${items.length === 1 ? "item" : "items"}` : "", o.delivery_location].filter(Boolean).join(" · ")}</small></span></span>
                  <span className="ord-dt">{shortDate(o.created_at)}</span>
                  <span className="ord-am r"><b>{money(total)}</b>{total > 0 && o.status !== "cancelled" && <small className={due > 0 ? "due" : "ok"}>{due > 0 ? `${money(due)} unpaid` : "Paid"}</small>}</span>
                  <span className={`ord-st ${st.dot}`}><i />{st.label}</span>
                  <span className="ord-ac">
                    {canSell && <button className="ord-b main" onClick={() => setSale(o)}>Record sale</button>}
                    {canDeliver && <button className="ord-b main" onClick={() => setAssign(o)}>Assign delivery</button>}
                    {canCancel && <button className="ord-b" onClick={() => void cancel(o)}>Cancel</button>}
                  </span>
                </div>
                {isOpen && (
                  <dl className="ord-more">
                    <div><dt>Phone</dt><dd>{o.phone || "—"}</dd></div>
                    <div><dt>Address</dt><dd>{o.delivery_location || "—"}</dd></div>
                    <div><dt>Paid</dt><dd>{money(paid)}</dd></div>
                    <div className="wide"><dt>Items</dt><dd>{items.map(it => `${it.quantity} ${it.unit} ${it.product_name}`).join(", ") || "—"}</dd></div>
                  </dl>)}
              </div>);
          })}
        </div>)}
      {sale && <SaleModal order={sale} onClose={() => setSale(null)} />}
      {assign && <AssignModal order={assign} onClose={() => setAssign(null)} />}
    </div>
  );
}
