import { useState } from "react";
import { AlertTriangle, Building2, ShieldCheck, Activity, Banknote, Camera, Coins, CheckCheck, Clock, MapPin, MapPinned, Map as MapIcon, Play, Truck, User, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { IconBtn, RecCard, RecordList, StatusChip, type Tone } from "../Records";
import { shortDate } from "../../lib/format";
import { errorText, requireSupabase, type DeliveryRow } from "../../lib/supabase";
import { useAdmin } from "../AdminData";
import LiveMap from "./LiveMap";
import Operations from "./Operations";
import DriverApp from "./DriverApp";
import SuppliersTab from "../ops/SuppliersTab";
import DriversTab from "../ops/DriversTab";
import PinPicker from "../ops/PinPicker";
import DeliveryFilters, { NO_FILTERS, dateFrom, type Filters } from "../ops/DeliveryFilters";
import { ATTENTION, type ListExtras } from "../ops/cities";
import { CashModal, type Due } from "../ops/CashModal";
import { Form, Modal, Tabs, callRpc, useAction, useLoad } from "../suite";


const label = (s: string) => s.replace("_", " ");
const tone = (s: string) => (s === "delivered" ? "good" : s === "failed" ? "muted" : "warn");

function DeliveryList() {
  const { deliveries, staff, profile, search, can, notify, reload } = useAdmin();
  const s = search.toLowerCase();
  const who = (id: string | null) => { const p = staff.find(x => x.id === id); return p ? p.full_name || p.email : id === profile.id ? "You" : "—"; };
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const boss = profile.role === "owner" || profile.role === "manager";
  // City, area and "needs attention" come from the database (owner/manager). Before migration 0042 is run this stays empty and the other filters still work.
  const extras = useLoad(() => (boss ? callRpc<ListExtras>("ops_delivery_list").catch(() => ({ thresholds: { notAcceptedMinutes: 30 }, rows: [] } as ListExtras)) : Promise.resolve({ thresholds: { notAcceptedMinutes: 30 }, rows: [] } as ListExtras)), [deliveries.length]);
  const ex = (id: string) => extras.data?.rows.find(r => r.id === id);
  const from = dateFrom(filters.date);
  const matches = (d: DeliveryRow) => `${d.orders?.order_number ?? ""} ${d.orders?.customer_name ?? ""} ${d.orders?.delivery_location ?? ""}`.toLowerCase().includes(s)
    && (!filters.status || d.status === filters.status) && (!filters.driver || d.assigned_to === filters.driver)
    && (!filters.city || ex(d.id)?.cityId === filters.city) && (from === null || new Date(d.created_at).getTime() >= from)
    && (!filters.attention || (ex(d.id)?.attention.length ?? 0) > 0);
  const rows = deliveries.filter(matches);
  const cityOptions = Array.from(new Map((extras.data?.rows ?? []).filter(r => r.cityId && r.city).map(r => [r.cityId!, r.city!])).entries()).map(([id, name]) => ({ id, name }));
  const driverOptions = Array.from(new Set(deliveries.map(d => d.assigned_to).filter(Boolean) as string[])).map(id => ({ id, name: who(id) }));
  const attentionCount = deliveries.filter(d => (ex(d.id)?.attention.length ?? 0) > 0).length;
  // Cash on Delivery: only the person assigned to a delivery sees (and can confirm) its cash. The payment becomes "paid" only when they confirm.
  const due = useLoad(() => (can("payments.collect") ? callRpc<Due[]>("my_cod_due") : Promise.resolve([] as Due[])), [deliveries.length]);
  const dueFor = (n?: string) => (due.data ?? []).find(x => x.order_number === n);
  const [cash, setCash] = useState<Due | null>(null);
  const [pin, setPin] = useState<DeliveryRow | null>(null);
  const canPin = profile.role === "owner" || profile.role === "manager";
  type Prog = { id: string; accepted: boolean; pickedUp: boolean; fee: number | null; hasProof: boolean };
  const prog = useLoad(() => (canPin ? callRpc<Prog[]>("ops_delivery_progress").catch(() => [] as Prog[]) : Promise.resolve([] as Prog[])), [deliveries.length]);
  const pg = (id: string) => (prog.data ?? []).find(x => x.id === id);
  const [feeFor, setFeeFor] = useState<DeliveryRow | null>(null);
  const [proof, setProof] = useState<{ ref: string; src: string } | null>(null);
  const viewProof = async (d: DeliveryRow) => { try { const src = await callRpc<string | null>("ops_delivery_proof", { p_delivery: d.id }); if (src) setProof({ ref: d.orders?.order_number ?? "", src }); else notify("No proof photo for this delivery."); } catch (e) { notify(errorText(e, "Could not open the photo")); } };
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
      <DeliveryFilters value={filters} onChange={setFilters} drivers={driverOptions} cities={cityOptions} showBoss={boss} attentionCount={attentionCount} shown={rows.length} total={deliveries.length} />
      <RecordList isEmpty={!rows.length} empty={deliveries.length ? "No deliveries match these filters" : "No deliveries yet"} icon={<Truck />}>
        {rows.map((d, i) => {
          const tn: Tone = d.status === "delivered" ? "good" : d.status === "failed" ? "bad" : "info";
          return (
            <RecCard key={d.id} i={i} tone={tn} lead={<Truck size={22} />} title={<span className="docno">{d.orders?.order_number ?? d.order_id.slice(0, 8)}</span>} sub={d.orders?.customer_name}
              facts={[...(ex(d.id)?.attention ?? []).map(a => ({ icon: <AlertTriangle size={14} />, text: ATTENTION[a] ?? a, tone: "warn" as const })), { icon: <MapPin size={14} />, text: d.orders?.delivery_location ?? "", tone: "place" }, { icon: <Building2 size={14} />, text: [ex(d.id)?.city, ex(d.id)?.zone].filter(Boolean).join(" · ") }, { icon: <User size={14} />, text: who(d.assigned_to) }, { icon: <Clock size={14} />, text: d.scheduled_at ? shortDate(d.scheduled_at) : "", tone: "time" }]}
              status={<StatusChip tone={tn} pulse={d.status === "in_transit"} icon={d.status === "delivered" ? <CheckCheck size={14} /> : d.status === "failed" ? <X size={14} /> : <Truck size={14} />}>{label(d.status)}</StatusChip>}
              actions={<>
                {canPin && d.status !== "delivered" && d.status !== "failed" && <IconBtn icon={<MapPinned size={17} />} label="Map pins" onClick={() => setPin(d)} />}
                {canPin && d.status !== "failed" && <IconBtn icon={<Coins size={17} />} label={pg(d.id)?.fee != null ? `Driver pay ${pg(d.id)!.fee} ETB` : "Set driver pay"} onClick={() => setFeeFor(d)} />}
                {canPin && pg(d.id)?.hasProof && <IconBtn icon={<Camera size={17} />} label="Delivery photo" onClick={() => void viewProof(d)} />}
                {dueFor(d.orders?.order_number) && <IconBtn primary tone="gold" icon={<Banknote size={17} />} label={`Cash ${Math.round(dueFor(d.orders?.order_number)!.amount)} ETB`} onClick={() => setCash(dueFor(d.orders?.order_number)!)} />}
                {mayAct(d) && d.status === "assigned" && <IconBtn primary tone="gold" icon={<Play size={16} />} label="Start" onClick={() => void move(d, "in_transit")} />}
                {mayAct(d) && d.status === "in_transit" && <><IconBtn primary tone="green" icon={<CheckCheck size={17} />} label="Delivered" onClick={() => void move(d, "delivered")} /><IconBtn tone="red" icon={<X size={17} />} label="Failed" onClick={() => void move(d, "failed")} /></>}
              </>}
              details={d.orders?.phone ? [["Phone", d.orders.phone]] : undefined} />
          );
        })}
      </RecordList>
      {feeFor && <FeeModal d={feeFor} current={pg(feeFor.id)?.fee ?? null} onClose={() => setFeeFor(null)} onDone={() => { setFeeFor(null); prog.reload(); }} />}
      {proof && <Modal title={`Delivery photo · ${proof.ref}`} onClose={() => setProof(null)}><img src={proof.src} alt="Proof of delivery" style={{ width: "100%", borderRadius: 12 }} /></Modal>}
      {pin && <PinPicker delivery={pin.id} title={pin.orders?.order_number ?? "Delivery"} onClose={() => setPin(null)} onDone={() => setPin(null)} />}
      {cash && <CashModal due={cash} onClose={() => setCash(null)} onDone={() => { setCash(null); due.reload(); }} />}
    </>
  );
}

function FeeModal({ d, current, onClose, onDone }: { d: DeliveryRow; current: number | null; onClose: () => void; onDone: () => void }) {
  const [fee, setFee] = useState(current != null ? String(current) : "");
  const { busy, run } = useAction();
  return (
    <Modal title={d.orders?.order_number ?? "Delivery"} kicker="DRIVER PAY" onClose={onClose}>
      <Form onSubmit={() => void run(() => callRpc("ops_set_driver_fee", { p_delivery: d.id, p_fee: Number(fee) }), "Driver pay saved.").then(ok => { if (ok) onDone(); })} busy={busy} submit="Save">
        <label>Pay for this delivery (ETB)<input required type="number" inputMode="decimal" min={0} max={1000000} step="0.01" value={fee} onChange={e => setFee(e.target.value)} autoFocus /></label>
        <p className="su-muted">The driver sees this on the job and in Earnings once it is delivered.</p>
      </Form>
    </Modal>
  );
}

type Tab = "list" | "map" | "ops" | "drivers" | "suppliers";

/** One Delivery section: the list, the live map, operations and (for drivers) the phone page. */
export default function Deliveries() {
  const { profile } = useAdmin();
  const boss = profile.role === "owner" || profile.role === "manager";
  const [tab, setTab] = useState<Tab>("list");
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [{ id: "list", label: "Deliveries", icon: <Truck size={15} /> }];
  if (boss) tabs.push({ id: "map", label: "Live map", icon: <MapIcon size={15} /> }, { id: "ops", label: "Operations", icon: <Activity size={15} /> }, { id: "drivers", label: "Drivers", icon: <ShieldCheck size={15} /> }, { id: "suppliers", label: "Suppliers", icon: <MapPin size={15} /> });
  // Drivers get their own phone app (Home, Deliveries, Earnings, Profile).
  if (profile.role === "delivery") return <DriverApp />;
  return (
    <>
      {tabs.length > 1 && <Tabs tabs={tabs} value={tab} onChange={setTab} label="Delivery sections" />}
      {tab === "list" && <DeliveryList />}
      {tab === "map" && boss && <LiveMap embedded />}
      {tab === "ops" && boss && <Operations embedded />}
      {tab === "drivers" && boss && <DriversTab />}
      {tab === "suppliers" && boss && <SuppliersTab />}
    </>
  );
}
