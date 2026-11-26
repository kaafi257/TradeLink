import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCheck, Crosshair, MapPin, Navigation, Phone, Play, Power, X } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { callRpc, useAction, useLoad, ErrorNote } from "../suite";
import DriverMap from "../ops/DriverMap";
import "../ops/ops.css";

type Job = { id: string; ref: string; status: string; customer: string; phone: string | null; address: string; items: string;
  supplier: { name: string; lat: number; lng: number } | null; dropoff: { lat: number; lng: number } | null };
type Mine = { online: boolean; vehicle: string; jobs: Job[] };

const nav = (p: { lat: number; lng: number }) => `https://www.openstreetmap.org/directions?to=${p.lat}%2C${p.lng}`;

/** The driver's phone page: go online to share location, see assigned deliveries, start and finish them. */
export default function DriverApp({ embedded = false }: { embedded?: boolean }) {
  const mine = useLoad(() => callRpc<Mine>("driver_my_jobs"), []);
  const { busy, run } = useAction();
  const [gps, setGps] = useState("");
  const last = useRef(0);
  const [here, setHere] = useState<[number, number] | null>(null);
  const online = !!mine.data?.online;

  useEffect(() => {
    if (!online) return;
    if (!navigator.geolocation) { setGps("This phone cannot share its location."); return; }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setGps("");
        setHere([pos.coords.latitude, pos.coords.longitude]);
        if (Date.now() - last.current < 8000) return;
        last.current = Date.now();
        void callRpc("agent_report_location", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_heading: pos.coords.heading ?? null, p_accuracy: pos.coords.accuracy ?? null }).catch(() => {});
      },
      err => setGps(err.code === 1 ? "Allow location access in your browser to share your position." : "Could not get your location."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [online]);

  useEffect(() => { const t = window.setInterval(() => mine.reload(), 15000); return () => window.clearInterval(t); }, [mine.reload]);
  const toggle = useCallback(() => run(() => callRpc("driver_set_online", { p_online: !online }).then(() => mine.reload())), [online, run, mine]);
  const mark = (id: string, kind: "pickup" | "dropoff") => {
    if (!here) { setGps("Waiting for your GPS position. Make sure you are online and location is allowed."); return Promise.resolve(false); }
    return run(() => callRpc("driver_set_pin", { p_delivery: id, p_kind: kind, p_lat: here[0], p_lng: here[1] }).then(() => mine.reload()), kind === "pickup" ? "Pickup saved here." : "Drop-off saved here.");
  };
  const move = (id: string, status: string) => run(() => callRpc("update_delivery", { p_delivery: id, p_status: status }).then(() => mine.reload()), `Marked ${status.replace("_", " ")}.`);

  return (
    <>
      {!embedded && (
      <PageHeading title="Driver" sub="Go online to share your location and receive deliveries." />
      )}
      <div className="drv">
        <ErrorNote text={mine.error} />
        <div className="drv-card drv-online">
          <div><b>{online ? "You are online" : "You are offline"}</b><br /><small>{online ? "Your location is shared with the team." : "Nobody can see your location."}</small></div>
          <button type="button" className={`btn ${online ? "outline" : ""}`} disabled={busy || mine.loading && !mine.data} onClick={() => void toggle()}><Power size={16} /> {online ? "Go offline" : "Go online"}</button>
        </div>
        {gps && <div className="ops-banner" role="alert">{gps}</div>}
        {online && <DriverMap here={here} jobs={mine.data?.jobs ?? []} />}
        {mine.data && mine.data.jobs.length === 0 && <p className="ops-empty" style={{ textAlign: "center" }}>No deliveries assigned to you right now.</p>}
        {mine.data?.jobs.map(j => (
          <div className="drv-card" key={j.id}>
            <div className="top"><b>{j.ref}</b><small>{j.status === "in_transit" ? "On the way" : "Assigned"}</small></div>
            <div>{j.customer}<br /><small>{j.address}</small></div>
            <small>{j.items}</small>
            <div className="drv-row">
              {j.status === "assigned" && !j.supplier && <button type="button" className="btn outline" disabled={busy || !online} onClick={() => void mark(j.id, "pickup")}><Crosshair size={15} /> Mark pickup here</button>}
              {!j.dropoff && <button type="button" className="btn outline" disabled={busy || !online} onClick={() => void mark(j.id, "dropoff")}><Crosshair size={15} /> Mark drop-off here</button>}
              {j.supplier && j.status === "assigned" && <a className="btn outline" href={nav(j.supplier)} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Pickup</a>}
              {j.dropoff && <a className="btn outline" href={nav(j.dropoff)} target="_blank" rel="noopener noreferrer"><MapPin size={15} /> Drop-off</a>}
              {j.phone && <a className="btn outline" href={`tel:${j.phone}`}><Phone size={15} /> Call</a>}
            </div>
            <div className="drv-row">
              {j.status === "assigned" && <button type="button" className="btn" disabled={busy} onClick={() => void move(j.id, "in_transit")}><Play size={15} /> Start</button>}
              {j.status === "in_transit" && <><button type="button" className="btn" disabled={busy} onClick={() => void move(j.id, "delivered")}><CheckCheck size={15} /> Delivered</button>
                <button type="button" className="btn outline" disabled={busy} onClick={() => void move(j.id, "failed")}><X size={15} /> Failed</button></>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
