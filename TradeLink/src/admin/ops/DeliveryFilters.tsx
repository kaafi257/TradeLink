import { AlertTriangle, Filter, X } from "lucide-react";

export type Filters = { status: string; driver: string; city: string; date: string; attention: boolean };
export const NO_FILTERS: Filters = { status: "", driver: "", city: "", date: "", attention: false };
export const isFiltered = (f: Filters) => !!(f.status || f.driver || f.city || f.date || f.attention);

/** The day a date filter starts (local time). */
export const dateFrom = (key: string): number | null => {
  const d = new Date();
  if (key === "today") { d.setHours(0, 0, 0, 0); return d.getTime(); }
  if (key === "7") return Date.now() - 7 * 864e5;
  if (key === "30") return Date.now() - 30 * 864e5;
  return null;
};

/** Compact filter bar for the delivery list. City and "needs attention" appear for owner and manager only. */
export default function DeliveryFilters({ value, onChange, drivers, cities, showBoss, attentionCount, shown, total }: {
  value: Filters; onChange: (f: Filters) => void; drivers: { id: string; name: string }[]; cities: { id: string; name: string }[];
  showBoss: boolean; attentionCount: number; shown: number; total: number;
}) {
  const set = (p: Partial<Filters>) => onChange({ ...value, ...p });
  return (
    <div className="dlf" role="search" aria-label="Filter deliveries">
      <Filter size={16} aria-hidden="true" style={{ color: "#5a6f8f" }} />
      <select aria-label="Status" value={value.status} onChange={e => set({ status: e.target.value })}>
        <option value="">All statuses</option><option value="pending">Pending</option><option value="assigned">Assigned</option><option value="in_transit">In transit</option><option value="delivered">Delivered</option><option value="failed">Failed</option>
      </select>
      <select aria-label="Driver" value={value.driver} onChange={e => set({ driver: e.target.value })}>
        <option value="">All drivers</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      {showBoss && cities.length > 0 && (
        <select aria-label="City" value={value.city} onChange={e => set({ city: e.target.value })}>
          <option value="">All cities</option>{cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}
      <select aria-label="Date" value={value.date} onChange={e => set({ date: e.target.value })}>
        <option value="">Any date</option><option value="today">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option>
      </select>
      {showBoss && (
        <button type="button" className={`ops-pill ${value.attention ? "on" : ""}`} aria-pressed={value.attention} onClick={() => set({ attention: !value.attention })}>
          <AlertTriangle size={15} /> Needs attention{attentionCount ? <em>{attentionCount}</em> : null}
        </button>
      )}
      {isFiltered(value) && <button type="button" className="dlf-clear" onClick={() => onChange(NO_FILTERS)}><X size={13} /> Clear</button>}
      <span className="dlf-count" aria-live="polite">{shown === total ? `${total} deliver${total === 1 ? "y" : "ies"}` : `${shown} of ${total}`}</span>
    </div>
  );
}
