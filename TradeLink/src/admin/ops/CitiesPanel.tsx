import { useState } from "react";
import { Building2, MapPin, Plus, Power } from "lucide-react";
import { callRpc, ErrorNote, useAction, useLoad } from "../suite";
import type { City } from "./cities";

/** Owner / manager: the cities TradeLink delivers in and the optional areas inside them. Nothing is ever deleted, only switched off. */
export default function CitiesPanel({ onChanged }: { onChanged: () => void }) {
  const list = useLoad(() => callRpc<City[]>("ops_cities"), []);
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [zoneName, setZoneName] = useState<Record<string, string>>({});
  const done = () => { list.reload(); onChanged(); };
  const addCity = () => void run(() => callRpc("ops_save_city", { p_id: null, p_name: name, p_active: true }).then(() => { setName(""); done(); }), "City added.");
  const toggleCity = (c: City) => void run(() => callRpc("ops_save_city", { p_id: c.id, p_name: c.name, p_active: !c.active }).then(done), c.active ? `${c.name} is switched off.` : `${c.name} is switched on.`);
  const addZone = (c: City) => void run(() => callRpc("ops_save_zone", { p_id: null, p_city: c.id, p_name: zoneName[c.id] ?? "", p_active: true }).then(() => { setZoneName(z => ({ ...z, [c.id]: "" })); done(); }), "Area added.");
  const toggleZone = (z: City["zones"][number]) => void run(() => callRpc("ops_save_zone", { p_id: z.id, p_city: null, p_name: z.name, p_active: !z.active }).then(done));
  return (
    <section className="cty" aria-label="Cities and areas">
      <ErrorNote text={list.error} />
      <form className="cty-add" onSubmit={e => { e.preventDefault(); if (name.trim()) addCity(); }}>
        <Building2 size={18} aria-hidden="true" />
        <input aria-label="New city name" placeholder="Add a city, for example Dire Dawa" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
        <button className="drs-btn" disabled={busy || name.trim().length < 2}><Plus size={16} /> Add</button>
      </form>
      {list.data?.length === 0 && <p className="ops-empty">No cities yet. Until you add one, drivers can be assigned to any delivery, as before. Once you add a city, every order needs a city and drivers only get deliveries in their cities.</p>}
      {list.data?.map(c => (
        <article key={c.id} className={`cty-card ${c.active ? "" : "off"}`}>
          <header>
            <b><Building2 size={16} /> {c.name}</b>
            <small>{c.drivers} driver{c.drivers === 1 ? "" : "s"} · {c.orders} order{c.orders === 1 ? "" : "s"}</small>
            <button type="button" className={`cty-sw ${c.active ? "on" : ""}`} aria-pressed={c.active} disabled={busy} onClick={() => toggleCity(c)} aria-label={c.active ? `Switch ${c.name} off` : `Switch ${c.name} on`}><Power size={15} /> {c.active ? "On" : "Off"}</button>
          </header>
          <div className="cty-zones">
            {c.zones.map(z => (
              <button key={z.id} type="button" className={`ops-pill ${z.active ? "on" : ""}`} aria-pressed={z.active} disabled={busy} onClick={() => toggleZone(z)} title={z.active ? "Tap to switch this area off" : "Tap to switch this area on"}><MapPin size={13} /> {z.name}</button>
            ))}
            <form className="cty-zadd" onSubmit={e => { e.preventDefault(); if ((zoneName[c.id] ?? "").trim()) addZone(c); }}>
              <input aria-label={`New area in ${c.name}`} placeholder="Add an area (optional)" maxLength={60} value={zoneName[c.id] ?? ""} onChange={e => setZoneName(z => ({ ...z, [c.id]: e.target.value }))} />
              <button className="ops-pill" disabled={busy || (zoneName[c.id] ?? "").trim().length < 2} aria-label={`Add area to ${c.name}`}><Plus size={14} /></button>
            </form>
          </div>
        </article>
      ))}
    </section>
  );
}
