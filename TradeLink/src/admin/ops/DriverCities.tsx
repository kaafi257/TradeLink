import { Building2 } from "lucide-react";
import { callRpc, useAction } from "../suite";
import type { City } from "./cities";

/** The cities one driver serves: tap a city to add or remove it. The server only gives a driver deliveries in these cities. */
export default function DriverCities({ profile, cities, selected, onChanged }: { profile: string; cities: City[]; selected: string[]; onChanged: () => void }) {
  const { busy, run } = useAction();
  const active = cities.filter(c => c.active || selected.includes(c.id));
  if (!active.length) return null;
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id];
    void run(() => callRpc("ops_set_driver_cities", { p_profile: profile, p_cities: next }).then(onChanged));
  };
  return (
    <div className="drs-cities" role="group" aria-label="Cities this driver serves">
      {active.map(c => (
        <button key={c.id} type="button" className={`ops-pill ${selected.includes(c.id) ? "on" : ""}`} aria-pressed={selected.includes(c.id)} disabled={busy} onClick={() => toggle(c.id)}><Building2 size={13} /> {c.name}</button>
      ))}
    </div>
  );
}
