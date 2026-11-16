import { CheckCheck, Clock, MapPin, Play, Truck, User, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip, type Tone } from "../Records";
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
      <RecordList isEmpty={!rows.length} empty="No deliveries yet" icon={<Truck />}>
        {rows.map((d, i) => {
          const tn: Tone = d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : "info";
          return (
            <RecCard key={d.id} i={i} tone={tn} lead={<Truck size={22} />} title={<span className="docno">{d.orders?.order_number ?? d.order_id.slice(0, 8)}</span>} sub={d.orders?.customer_name}
              facts={[{ icon: <MapPin size={14} />, text: d.orders?.delivery_location ?? "" }, { icon: <User size={14} />, text: who(d.assigned_to) }, { icon: <Clock size={14} />, text: d.scheduled_at ? shortDate(d.scheduled_at) : "" }]}
              status={<StatusChip tone={tn} pulse={d.status === "in_transit"} icon={d.status === "delivered" ? <CheckCheck size={14} /> : d.status === "failed" ? <X size={14} /> : <Truck size={14} />}>{label(d.status)}</StatusChip>}
              actions={<>
                {mayAct(d) && d.status === "assigned" && <IconBtn primary tone="gold" icon={<Play size={16} />} label="Start" onClick={() => void move(d, "in_transit")} />}
                {mayAct(d) && d.status === "in_transit" && <><IconBtn primary tone="green" icon={<CheckCheck size={17} />} label="Delivered" onClick={() => void move(d, "delivered")} /><IconBtn tone="red" icon={<X size={17} />} label="Failed" onClick={() => void move(d, "failed")} /></>}
              </>}
              details={d.orders?.phone ? [["Phone", d.orders.phone]] : undefined} />
          );
        })}
      </RecordList>
    </>
  );
}
