import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** A small map with one draggable pin, centred on the GPS position. */
export default function PinAdjust({ lat, lng, onMove }: { lat: number; lng: number; onMove: (p: { lat: number; lng: number }) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onMove); cb.current = onMove;
  const mk = useRef<any>(null);
  const map = useRef<any>(null);
  useEffect(() => {
    if (!host.current) return;
    const m = L.map(host.current, { center: [lat, lng], zoom: 18 });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(m);
    const icon = L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15], html: '<div style="width:30px;height:30px;border-radius:50%;background:#2f6fd6;border:4px solid #fff;box-shadow:0 2px 10px #0b1f3a66"></div>' });
    const k = L.marker([lat, lng], { icon, draggable: true }).addTo(m);
    k.on("dragend", () => { const p = k.getLatLng(); cb.current({ lat: p.lat, lng: p.lng }); });
    m.on("click", (e: any) => { k.setLatLng(e.latlng); cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }); });
    mk.current = k; map.current = m;
    setTimeout(() => m.invalidateSize(), 50);
    return () => { m.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={host} style={{ height: 240, width: "100%", borderRadius: 14, overflow: "hidden", border: "1px solid #dbe5f3" }} aria-label="Drag the pin onto your exact location" />;
}
