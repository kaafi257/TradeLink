import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const dot = (c: string) => L.divIcon({ className: "", iconSize: [24, 24], iconAnchor: [12, 12], html: `<div style="width:24px;height:24px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 8px #0b1f3a55"></div>` });

export default function TrackMap({ driver, drop }: { driver: [number, number]; drop: [number, number] | null }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const layer = useRef<any>(null);
  const fitted = useRef(false);
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { center: driver, zoom: 15, zoomControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    layer.current = L.layerGroup().addTo(m); map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); map.current = null; fitted.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const g = layer.current, m = map.current; if (!g || !m) return;
    g.clearLayers();
    L.marker(driver, { icon: dot("#0b1f3a") }).bindTooltip("Driver").addTo(g);
    const pts: [number, number][] = [driver];
    if (drop) { L.marker(drop, { icon: dot("#2f6fd6") }).bindTooltip("You").addTo(g); pts.push(drop); L.polyline([driver, drop], { color: "#2f6fd6", weight: 4, opacity: 0.7, dashArray: "2 8" }).addTo(g); }
    if (!fitted.current) { fitted.current = true; if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30], maxZoom: 16 }); }
  }, [driver, drop]);
  return <div ref={host} style={{ height: 280, borderRadius: 14, overflow: "hidden", border: "1px solid #dbe5f3" }} aria-label="Map showing your driver" />;
}
