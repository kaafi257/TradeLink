import { MapPinned } from "lucide-react";
import type { CityOption } from "../lib/checkout";

export type CityChoice = { city: string; zone: string };

/** City (and area, when the city has areas) for delivery. Shows nothing when no city has been set up yet, so checkout never blocks. */
export default function CityPicker({ cities, value, onChange }: { cities: CityOption[]; value: CityChoice; onChange: (v: CityChoice) => void }) {
  if (!cities.length) return null;
  const zones = cities.find(c => c.id === value.city)?.zones ?? [];
  return (
    <>
      <label>
        <span className="cp-l"><MapPinned size={14} aria-hidden="true" /> City</span>
        <select name="city" required value={value.city} onChange={e => onChange({ city: e.target.value, zone: "" })}>
          <option value="" disabled>Choose your city</option>
          {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {zones.length > 0 && (
        <label>
          <span className="cp-l">Area</span>
          <select name="zone" required value={value.zone} onChange={e => onChange({ ...value, zone: e.target.value })}>
            <option value="" disabled>Choose your area</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      )}
    </>
  );
}
