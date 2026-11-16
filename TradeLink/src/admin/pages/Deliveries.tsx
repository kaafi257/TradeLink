import { DataTable, PageHeading } from "../../components/ui";
import { shortDate } from "../../lib/format";
import { errorText, requireSupabase, type DeliveryRow } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

const label = (s: string) => s.replace("_", " ");
const tone = (s: string) => (s === "delivered" ? "good" : s === "failed" ? "muted" : "warn");

export default function Deliveries() {
  const { deliveries, staff, profile, search, can, notify, reload } = useAdmin();
  const s = search.toLowerCase();
  const who = (id: string | null) => { const p = staff.find(x => x.id === id); return p ? p.full_name || p.email : id === profile.id ? "You" : "—"; };
  const rows = deliveries.filter(d => `${d.orders?.order_number ?? ""} ${d.orders?.customer_name ?? ""} ${d.orders?.delivery_location ?? ""}`.toLowerCase().includes(s));
  const mayAct = (d: DeliveryRow) => can("deliveries.assign") || (can("deliveries.update") && d.assigned_to === profile.id);

  const move = async (d: DeliveryRow, status: string) => {
    try {
      const { error } = await requireSupabase().rpc("update_delivery", { p_delivery: d.id, p_status: status });
      if (error) throw error;
      notify(`Delivery marked ${label(status)}.`);
      await reload();
    } catch (e) { notify(errorText(e, "Could not update the delivery")); }
  };

  return (
    <>
      <PageHeading title="Deliveries" sub={profile.role === "delivery" ? "Deliveries assigned to you." : "Track every assigned delivery. Assign new ones from the Orders page."} />
      <DataTable headers={["Order", "Customer", "Destination", "Assigned to", "Scheduled", "Status", "Actions"]} isEmpty={!rows.length} empty="No deliveries yet">
        {rows.map(d => (
          <tr key={d.id}>
            <td><b>{d.orders?.order_number ?? d.order_id.slice(0, 8)}</b></td>
            <td>{d.orders?.customer_name}<br /><small>{d.orders?.phone}</small></td>
            <td>{d.orders?.delivery_location}</td><td>{who(d.assigned_to)}</td>
            <td>{d.scheduled_at ? shortDate(d.scheduled_at) : "—"}</td>
            <td><span className={`status ${tone(d.status)}`}>{label(d.status)}</span></td>
            <td>
              {mayAct(d) && d.status === "assigned" && <button className="btn outline" onClick={() => void move(d, "in_transit")}>Start delivery</button>}
              {mayAct(d) && d.status === "in_transit" && <><button className="btn green" onClick={() => void move(d, "delivered")}>Mark delivered</button>{" "}<button className="btn outline" onClick={() => void move(d, "failed")}>Failed</button></>}
            </td>
          </tr>
        ))}
      </DataTable>
    </>
  );
}
