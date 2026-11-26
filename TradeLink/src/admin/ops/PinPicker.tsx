import { useEffect, useRef, useState } from "react";
import { MapPin, Store } from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Form, Modal, callRpc, useAction } from "../suite";
import "./ops.css";

type Pt = [number, number];
const CITY: Pt = [9.5931, 41.8661];
const icon = (c: string) => L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div style="width:26px;height:26px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 8px #0b1f3a55"></div>` });

/** Staff tap the map to set where the driver picks up and where the customer receives a real delivery. */
export default function PinPicker({ delivery, title, onClose, onDone }: { delivery: string; title: string; onClose: () => void; onDone: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"supplier" | "customer">("supplier");
  const modeRef = useRef(mode); modeRef.current = mode;
  const [sup, setSup] = useState<Pt | null>(null);
  const [cus, setCus] = useState<Pt | null>(null);
  const [name, setName] = useState("");
  const { busy, run } = useAction();
  const markers = useRef<{ s?: any; c?: any }>({});

  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { center: CITY, zoom: 13 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    m.on("click", (e: any) => {
      const p: Pt = [e.latlng.lat, e.latlng.lng];
      if (modeRef.current === "supplier") { setSup(p); markers.current.s?.remove(); markers.current.s = L.marker(p, { icon: icon("#0b1f3a") }).addTo(m); }
      else { setCus(p); markers.current.c?.remove(); markers.current.c = L.marker(p, { icon: icon("#2f6fd6") }).addTo(m); }
    });
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); };
  }, []);

  const save = () => run(() => callRpc("ops_set_pins", { p_delivery: delivery, p_supplier_name: name, p_supplier_lat: sup![0], p_supplier_lng: sup![1], p_customer_lat: cus![0], p_customer_lng: cus![1] }), "Map pins saved.").then(ok => { if (ok) onDone(); });
  return (
    <Modal title={title} kicker="MAP PINS" onClose={onClose}>
      <div className="pp-tabs">
        <button type="button" className={mode === "supplier" ? "on" : ""} onClick={() => setMode("supplier")}><Store size={16} /> Pickup {sup && "✓"}</button>
        <button type="button" className={mode === "customer" ? "on" : ""} onClick={() => setMode("customer")}><MapPin size={16} /> Drop-off {cus && "✓"}</button>
      </div>
      <div ref={host} className="pp-map" aria-label="Tap the map to place the pin" />
      <Form onSubmit={() => void save()} busy={busy || !sup || !cus} submit="Save pins">
        <label>Pickup place name<input required minLength={2} maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Supplier or warehouse" /></label>
        {(!sup || !cus) && <p className="su-muted">Tap the map once for pickup and once for drop-off.</p>}
      </Form>
    </Modal>
  );
}
