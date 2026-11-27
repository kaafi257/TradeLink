import { lazy, Suspense, useState } from "react";
import { Crosshair } from "lucide-react";
import { Form, Modal, callRpc, useAction } from "../suite";
import { getBestFix } from "../../lib/gps";
import type { SupplierPlace } from "./ops";

const PinAdjust = lazy(() => import("../../components/PinAdjust"));
const CITY = { lat: 9.5931, lng: 41.8661 };

/** Owner or manager sets or changes where a supplier's shop is. Suppliers cannot change it themselves once saved. */
export default function SupplierLocationModal({ place, onClose, onDone }: { place: SupplierPlace; onClose: () => void; onDone: () => void }) {
  const [pt, setPt] = useState<{ lat: number; lng: number }>(place.lat != null && place.lng != null ? { lat: place.lat, lng: place.lng } : CITY);
  const [key, setKey] = useState(0);
  const [msg, setMsg] = useState("");
  const [moved, setMoved] = useState(place.lat != null);
  const { busy, run } = useAction();
  const gps = async () => { setMsg("Finding an accurate position…"); try { const f = await getBestFix({ targetM: 30, maxMs: 20000 }); setPt({ lat: f.lat, lng: f.lng }); setMoved(true); setKey(k => k + 1); setMsg(`GPS accuracy about ${f.accuracy} m. Drag the pin onto the exact spot.`); } catch (e) { setMsg(e instanceof Error ? e.message : "Could not get GPS."); } };
  return (
    <Modal title={place.name} kicker={place.lat != null ? "CHANGE SHOP LOCATION" : "SET SHOP LOCATION"} onClose={onClose}>
      <button type="button" className="btn outline" onClick={() => void gps()} style={{ marginBottom: 10 }}><Crosshair size={15} /> Use my GPS (stand at the shop)</button>
      {msg && <p className="su-muted" role="status">{msg}</p>}
      <Suspense fallback={<p className="su-muted">Loading map…</p>}>
        <PinAdjust key={key} lat={pt.lat} lng={pt.lng} onMove={p => { setPt(p); setMoved(true); }} />
      </Suspense>
      <p className="su-muted" style={{ marginTop: 8 }}>Zoom in, then drag the pin or tap the map to the exact shop door.</p>
      <Form onSubmit={() => void run(() => callRpc("ops_set_supplier_location", { p_supplier: place.id, p_lat: pt.lat, p_lng: pt.lng }), "Shop location saved.").then(ok => { if (ok) onDone(); })} busy={busy || !moved} submit="Save location">{null}</Form>
    </Modal>
  );
}
