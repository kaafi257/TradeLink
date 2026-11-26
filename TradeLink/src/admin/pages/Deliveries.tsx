import { useState } from "react";
import { Activity, Banknote, CheckCheck, Clock, MapPin, MapPinned, Map as MapIcon, Play, Truck, User, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip, type Tone } from "../Records";
import { shortDate } from "../../lib/format";
import { errorText, requireSupabase, type DeliveryRow } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import LiveMap from "./LiveMap";
import Operations from "./Operations";
import DriverApp from "./DriverApp";
import PinPicker from "../ops/PinPicker";
import { Form, Modal, Tabs, callRpc, useAction, useLoad } from "../suite";

type Due = { payment_id: string; order_number: string; customer_name: string; delivery_location: string; amount: number; delivery_status: string };

const label = (s: string) => s.replace("_", " ");
const tone = (s: string) => (s === "delivered" ? "good" : s === "failed" ? "muted" : "warn");

function DeliveryList() {
  const { deliveries, staff, profile, search, can, notify, reload } = useAdmin();
  const s = search.toLowerCase();
  const who = (id: string | null) => { const p = staff.find(x => x.id === id); return p ? p.full_name || p.email : id === profile.id ? "You" : "—"; };
  const rows = deliveries.filter(d => `${d.orders?.order_number ?? ""} ${d.orders?.customer_name ?? ""} ${d.orders?.delivery_location ?? ""}`.toLowerCase().includes(s));
  // Cash on Delivery: only the person assigned to a delivery sees (and can confirm) its cash. The payment becomes "paid" only when they confirm.
  const due = useLoad(() => (can("payments.collect") ? callRpc<Due[]>("my_cod_due") : Promise.resolve([] as Due[])), [deliveries.length]);
  const dueFor = (n?: string) => (due.data ?? []).find(x => x.order_number === n);
  const [cash, setCash] = useState<Due | null>(null);
  const [pin, setPin] = useState<DeliveryRow | null>(null);
  const canPin = profile.role === "owner" || profile.role === "manager";
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
              facts={[{ icon: <MapPin size={14} />, text: d.orders?.delivery_location ?? "", tone: "place" }, { icon: <User size={14} />, text: who(d.assigned_to) }, { icon: <Clock size={14} />, text: d.scheduled_at ? shortDate(d.scheduled_at) : "", tone: "time" }]}
              status={<StatusChip tone={tn} pulse={d.status === "in_transit"} icon={d.status === "delivered" ? <CheckCheck size={14} /> : d.status === "failed" ? <X size={14} /> : <Truck size={14} />}>{label(d.status)}</StatusChip>}
              actions={<>
                {canPin && d.status !== "delivered" && d.status !== "failed" && <IconBtn icon={<MapPinned size={17} />} label="Map pins" onClick={() => setPin(d)} />}
                {dueFor(d.orders?.order_number) && <IconBtn primary tone="gold" icon={<Banknote size={17} />} label={`Cash ${Math.round(dueFor(d.orders?.order_number)!.amount)} ETB`} onClick={() => setCash(dueFor(d.orders?.order_number)!)} />}
                {mayAct(d) && d.status === "assigned" && <IconBtn primary tone="gold" icon={<Play size={16} />} label="Start" onClick={() => void move(d, "in_transit")} />}
                {mayAct(d) && d.status === "in_transit" && <><IconBtn primary tone="green" icon={<CheckCheck size={17} />} label="Delivered" onClick={() => void move(d, "delivered")} /><IconBtn tone="red" icon={<X size={17} />} label="Failed" onClick={() => void move(d, "failed")} /></>}
              </>}
              details={d.orders?.phone ? [["Phone", d.orders.phone]] : undefined} />
          );
        })}
      </RecordList>
      {pin && <PinPicker delivery={pin.id} title={pin.orders?.order_number ?? "Delivery"} onClose={() => setPin(null)} onDone={() => setPin(null)} />}
      {cash && <CashModal due={cash} onClose={() => setCash(null)} onDone={() => { setCash(null); due.reload(); }} />}
    </>
  );
}

function CashModal({ due, onClose, onDone }: { due: Due; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(String(Number(due.amount)));
  return (
    <Modal title={`Cash for ${due.order_number}`} kicker="CASH ON DELIVERY" onClose={onClose}>
      <p className="su-muted">{due.customer_name}. Confirm only after you have the cash in your hand. The amount must equal what is due.</p>
      <Form onSubmit={() => void run(() => callRpc("confirm_cod_collection", { p_payment: due.payment_id, p_amount: Number(amount) }), "Cash confirmed.").then(ok => { if (ok) onDone(); })} busy={busy} submit="Cash received">
        <label>Amount collected (ETB)<input type="number" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      </Form>
    </Modal>
  );
}

type Tab = "list" | "map" | "ops" | "driver";

/** One Delivery section: the list, the live map, operations and (for drivers) the phone page. */
export default function Deliveries() {
  const { profile } = useAdmin();
  const boss = profile.role === "owner" || profile.role === "manager";
  const [tab, setTab] = useState<Tab>("list");
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [{ id: "list", label: "Deliveries", icon: <Truck size={15} /> }];
  if (boss) tabs.push({ id: "map", label: "Live map", icon: <MapIcon size={15} /> }, { id: "ops", label: "Operations", icon: <Activity size={15} /> });
  if (profile.role === "delivery") tabs.push({ id: "driver", label: "Driver", icon: <MapPin size={15} /> });
  return (
    <>
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} label="Delivery sections" />}
      {tab === "list" && <DeliveryList />}
      {tab === "map" && boss && <LiveMap embedded />}
      {tab === "ops" && boss && <Operations embedded />}
      {tab === "driver" && profile.role === "delivery" && <DriverApp embedded />}
    </>
  );
}
