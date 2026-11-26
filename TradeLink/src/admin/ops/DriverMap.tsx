import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./ops.css";

type Pt = { lat: number; lng: number };
type Job = { id: string; ref: string; supplier: (Pt & { name: string }) | null; dropoff: Pt | null };
const dot = (c: string, sq = false) => L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div style="width:24px;height:24px;border-radius:${sq ? "7px" : "50%"};background:${c};border:3px solid #fff;box-shadow:0 2px 8px #0b1f3a55"></div>` });

/** The driver's own map: where they are, where to pick up (navy square) and where to drop off (blue dot). */
export default function DriverMap({ here, jobs }: { here: [number, number] | null; jobs: Job[] }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const group = useRef<any>(null);
  const fitted = useRef(false);

  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { center: [9.5931, 41.8661], zoom: 13 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    group.current = L.layerGroup().addTo(m); map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; fitted.current = false; };
  }, []);

  useEffect(() => {
    const g = group.current, m = map.current; if (!g || !m) return;
    g.clearLayers();
    const pts: [number, number][] = [];
    if (here) { L.marker(here, { icon: dot("#5b9bf0") }).bindTooltip("You").addTo(g); pts.push(here); }
    for (const j of jobs) {
      if (j.supplier) { const p: [number, number] = [j.supplier.lat, j.supplier.lng]; L.marker(p, { icon: dot("#0b1f3a", true) }).bindTooltip(`Pickup ${j.ref}: ${j.supplier.name}`).addTo(g); pts.push(p); }
      if (j.dropoff) { const p: [number, number] = [j.dropoff.lat, j.dropoff.lng]; L.marker(p, { icon: dot("#2f6fd6") }).bindTooltip(`Drop-off ${j.ref}`).addTo(g); pts.push(p); }
    }
    if (pts.length && !fitted.current) { fitted.current = true; m.fitBounds(pts, { padding: [30, 30], maxZoom: 16 }); }
  }, [here, jobs]);

  return <div ref={host} className="pp-map" style={{ cursor: "grab" }} aria-label="Map with your position, pickup and drop-off" />;
}
