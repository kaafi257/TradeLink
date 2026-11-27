import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { logoUrl } from "../../pages/supplier/files";
import { AGENT_LABEL, effectiveStatus, isLate, isOpen, type Agent, type DriverInfo, type Job, type SupplierPlace } from "./ops";

export type Layers = { drivers: boolean; suppliers: boolean; customers: boolean; lateOnly: boolean };
export type Selection = { kind: "agent" | "job" | "shop"; id: string } | null;

const CITY: [number, number] = [9.5931, 41.8661];

const COLORS = { driver: "#5b9bf0", driverPaused: "#8a968f", driverOffline: "#b8c2bc", supplier: "#0b1f3a", customer: "#2f6fd6", late: "#c0392b", warn: "#6b86ad" };

const svg = (inner: string, size = 40) => `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">${inner}</svg>`;

function agentIcon(a: Agent, selected: boolean) {
  const s = effectiveStatus(a);
  const fill = s === "paused" ? COLORS.driverPaused : s === "offline" ? COLORS.driverOffline : COLORS.driver;
  const ring = selected ? `<circle cx="20" cy="20" r="19" fill="none" stroke="#0b1f3a" stroke-width="3"/>` : "";
  return L.divIcon({
    className: "ops-marker", iconSize: [40, 40], iconAnchor: [20, 20],
    html: svg(`${ring}<circle cx="20" cy="20" r="14" fill="${fill}" stroke="#fff" stroke-width="3"/><path d="M13.5 22v-5h8l3 3v2zM15.5 24.5a1.5 1.5 0 100 .1M23 24.5a1.5 1.5 0 100 .1" fill="none" stroke="#1b1405" stroke-width="1.6" stroke-linejoin="round"/>`),
  });
}

function supplierIcon(selected: boolean) {
  const ring = selected ? `<rect x="2" y="2" width="36" height="36" rx="11" fill="none" stroke="#5b9bf0" stroke-width="3"/>` : "";
  return L.divIcon({
    className: "ops-marker", iconSize: [40, 40], iconAnchor: [20, 20],
    html: svg(`${ring}<rect x="6" y="6" width="28" height="28" rx="8" fill="${COLORS.supplier}" stroke="#fff" stroke-width="3"/><path d="M12.5 16h15l-1.5 5h-12zM14.5 21v8h11v-8" fill="none" stroke="#5b9bf0" stroke-width="2" stroke-linejoin="round"/>`),
  });
}

function customerIcon(late: boolean, selected: boolean) {
  const fill = late ? COLORS.late : COLORS.customer;
  const ring = selected ? `<circle cx="20" cy="15" r="14" fill="none" stroke="#5b9bf0" stroke-width="3"/>` : "";
  return L.divIcon({
    className: "ops-marker", iconSize: [40, 46], iconAnchor: [20, 40],
    html: `<svg width="40" height="46" viewBox="0 0 40 46" aria-hidden="true">${ring}<path d="M20 40s13-11 13-23a13 13 0 10-26 0c0 12 13 23 13 23z" fill="${fill}" stroke="#fff" stroke-width="3"/><path d="M14 16l6-5 6 5v7h-12z" fill="#fff"/></svg>`,
  });
}

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";

/** A round photo or logo marker with a status ring and a name label, so every pin says who it is. */
function badgeIcon(o: { img: string | null; text: string; label: string; ring: string; selected: boolean; square?: boolean; tick?: boolean }) {
  const r = o.square ? "12px" : "50%";
  const inner = o.img ? `<img src="${esc(o.img)}" alt="" />` : `<b>${esc(o.text)}</b>`;
  return L.divIcon({
    className: "ops-marker", iconSize: [46, 62], iconAnchor: [23, 23],
    html: `<div class="ops-badge ${o.selected ? "sel" : ""}"><span class="ops-av" style="border-color:${o.ring};border-radius:${r}">${inner}</span>${o.tick ? '<i class="ops-tick">✓</i>' : ""}<em>${esc(o.label)}</em></div>`,
  });
}

type Props = {
  agents: Agent[]; jobs: Job[]; layers: Layers; selection: Selection; now: number;
  places: SupplierPlace[]; driverInfo: DriverInfo[]; photos: Record<string, string>;
  onSelect: (s: Selection) => void;
};

/** A real street map (OpenStreetMap tiles) with every driver, supplier pickup and waiting customer on it. */
export default function OpsMap({ agents, jobs, layers, selection, now, places, driverInfo, photos, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const group = useRef<any>(null);
  const fitted = useRef(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!host.current || map.current) return;
    const m = L.map(host.current, { center: CITY, zoom: 12, zoomControl: false, attributionControl: true });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    }).addTo(m);
    group.current = L.layerGroup().addTo(m);
    map.current = m;
    const resize = new ResizeObserver(() => m.invalidateSize());
    resize.observe(host.current);
    return () => { resize.disconnect(); m.remove(); map.current = null; group.current = null; fitted.current = false; };
  }, []);

  useEffect(() => {
    const m = map.current, g = group.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts: [number, number][] = [];
    const byId = new Map(agents.map(a => [a.id, a]));
    const open = jobs.filter(isOpen);
    const picked = (jid: string, aid: string | null) => selection?.kind === "job" ? selection.id === jid : selection?.kind === "agent" ? selection.id === aid : false;

    // Routes first, so markers sit on top of them.
    for (const j of open) {
      const a = j.agentId ? byId.get(j.agentId) : undefined;
      const late = isLate(j, now);
      const stale = a ? effectiveStatus(a, now) === "paused" : false;
      const hot = picked(j.id, j.agentId);
      if (j.status === "picked_up" && a?.lat != null && a.lng != null) {
        L.polyline([[a.lat, a.lng], [j.customer.lat, j.customer.lng]], { color: late ? COLORS.late : stale ? COLORS.driverPaused : COLORS.supplier, weight: hot ? 6 : 4, opacity: hot ? 1 : 0.75 }).addTo(g);
      } else if (j.status === "assigned" && a?.lat != null && a.lng != null) {
        L.polyline([[a.lat, a.lng], [j.supplier.lat, j.supplier.lng]], { color: "#6b7b76", weight: hot ? 5 : 3, dashArray: "2 9", lineCap: "round" }).addTo(g);
        L.polyline([[j.supplier.lat, j.supplier.lng], [j.customer.lat, j.customer.lng]], { color: "#9aa8a3", weight: 2, dashArray: "6 8", opacity: 0.8 }).addTo(g);
      } else if (j.status === "waiting") {
        L.polyline([[j.supplier.lat, j.supplier.lng], [j.customer.lat, j.customer.lng]], { color: late ? COLORS.late : COLORS.warn, weight: hot ? 5 : 3, dashArray: "10 8", opacity: 0.9 }).addTo(g);
      }
    }

    const shopNames = new Set<string>();
    if (layers.suppliers && !layers.lateOnly) {
      for (const sp of places) {
        if (sp.lat == null || sp.lng == null) continue;
        shopNames.add(sp.name);
        const ring = sp.status === "approved" && sp.active ? COLORS.supplier : COLORS.driverPaused;
        const sel = selection?.kind === "shop" && selection.id === sp.id;
        const mk = L.marker([sp.lat, sp.lng], { icon: badgeIcon({ img: logoUrl(sp.logo), text: initials(sp.name), label: sp.name, ring, selected: sel, square: true }), title: sp.name, keyboard: true }).addTo(g);
        mk.on("click", () => onSelectRef.current({ kind: "shop", id: sp.id }));
        pts.push([sp.lat, sp.lng]);
      }
    }
    if (layers.suppliers) {
      const seen = new Set<string>();
      for (const j of open) {
        if (layers.lateOnly && !isLate(j, now)) continue;
        if (shopNames.has(j.supplier.name)) continue;
        const key = `${j.supplier.lat},${j.supplier.lng}`;
        const sel = selection?.kind === "job" && selection.id === j.id;
        if (seen.has(key) && !sel) continue;
        seen.add(key);
        const mk = L.marker([j.supplier.lat, j.supplier.lng], { icon: supplierIcon(sel), title: j.supplier.name, keyboard: true }).addTo(g);
        mk.on("click", () => onSelectRef.current({ kind: "job", id: j.id }));
        pts.push([j.supplier.lat, j.supplier.lng]);
      }
    }
    if (layers.customers) {
      for (const j of open) {
        const late = isLate(j, now);
        if (layers.lateOnly && !late) continue;
        const sel = selection?.kind === "job" && selection.id === j.id;
        const mk = L.marker([j.customer.lat, j.customer.lng], { icon: customerIcon(late, sel), title: `${j.customer.name}, ${j.customer.area}`, keyboard: true }).addTo(g);
        mk.on("click", () => onSelectRef.current({ kind: "job", id: j.id }));
        pts.push([j.customer.lat, j.customer.lng]);
      }
    }
    if (layers.drivers) {
      for (const a of agents) {
        if (a.lat == null || a.lng == null || a.status === "offline") continue;
        if (layers.lateOnly) { const job = jobs.find(j => j.id === a.jobId); if (!job || !isLate(job, now)) continue; }
        const sel = selection?.kind === "agent" && selection.id === a.id;
        const info = driverInfo.find(d => d.id === a.id);
        const st = effectiveStatus(a, now);
        const ring = st === "paused" ? COLORS.driverPaused : COLORS.driver;
        const icon = photos[a.id] || info?.verified ? badgeIcon({ img: photos[a.id] ?? null, text: initials(a.name), label: `${a.name.split(" ")[0]} · ${AGENT_LABEL[st]}`, ring, selected: sel, tick: !!info?.verified }) : agentIcon(a, sel);
        const mk = L.marker([a.lat, a.lng], { icon, title: `${a.name}, ${a.vehicle}`, keyboard: true, zIndexOffset: 1000 }).addTo(g);
        mk.on("click", () => onSelectRef.current({ kind: "agent", id: a.id }));
        pts.push([a.lat, a.lng]);
      }
    }

    if (!fitted.current && pts.length) { m.fitBounds(pts, { padding: [60, 60], maxZoom: 14 }); fitted.current = true; }
  }, [agents, jobs, layers, selection, now, places, driverInfo, photos]);

  // Selecting something from the list brings it into view.
  useEffect(() => {
    const m = map.current;
    if (!m || !selection) return;
    if (selection.kind === "agent") { const a = agents.find(x => x.id === selection.id); if (a?.lat != null && a.lng != null) m.panTo([a.lat, a.lng]); }
    else if (selection.kind === "shop") { const sp = places.find(x => x.id === selection.id); if (sp?.lat != null && sp.lng != null) m.setView([sp.lat, sp.lng], Math.max(m.getZoom(), 15)); }
    else { const j = jobs.find(x => x.id === selection.id); if (j) m.fitBounds([[j.supplier.lat, j.supplier.lng], [j.customer.lat, j.customer.lng]], { padding: [90, 90], maxZoom: 15 }); }
    // Only when the selection itself changes, not on every refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.kind, selection?.id]);

  return <div ref={host} className="ops-map" role="application" aria-label="Live map of drivers, suppliers and customers" />;
}
