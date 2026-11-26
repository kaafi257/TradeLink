import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { useOpsData, effectiveStatus, isLate, isOpen, secondsSince } from "../ops/ops";
import OpsMap, { type Layers, type Selection } from "../ops/OpsMap";
import { DetailPanel } from "../ops/parts";
import "../ops/ops.css";

export default function LiveMap() {
  const { snapshot, unpinned, loading, error, refreshedAt, now, reload } = useOpsData();
  const [layers, setLayers] = useState<Layers>({ drivers: true, suppliers: true, customers: true, lateOnly: false });
  const [selection, setSelection] = useState<Selection>(null);
  const { agents, jobs } = snapshot;

  const counts = useMemo(() => ({
    drivers: agents.filter(a => a.status !== "offline").length,
    suppliers: new Set(jobs.filter(isOpen).map(j => j.supplier.name)).size,
    customers: jobs.filter(isOpen).length,
    late: jobs.filter(j => isLate(j, now)).length,
    paused: agents.filter(a => effectiveStatus(a, now) === "paused").length,
  }), [agents, jobs, now]);

  const toggle = (k: keyof Layers) => setLayers(l => ({ ...l, [k]: !l[k] }));
  const pill = (k: keyof Layers, label: string, n: number, cls: string) => (
    <button key={k} type="button" className={`ops-pill ${layers[k] ? "on" : ""}`} aria-pressed={layers[k]} onClick={() => toggle(k)}>
      <i className={cls} />{label} <em>{n}</em>
    </button>
  );
  const age = secondsSince(new Date(refreshedAt).toISOString(), now) ?? 0;

  return (
    <>
      <PageHeading title="Live map" sub="Every driver, supplier pickup and waiting customer on one street map."
        action={<button type="button" className="btn outline" onClick={reload}><RefreshCw size={15} /> Refresh</button>} />
      {error && <div className="ops-banner" role="alert">{error}</div>}
      {!error && !loading && jobs.length === 0 && agents.every(a => a.status === "offline") && (
        <div className="ops-banner" role="status">No active deliveries or online drivers right now.{unpinned.length > 0 && <> {unpinned.length} delivery{unpinned.length > 1 ? " needs" : "ies need"} map pins (open Deliveries).</>}</div>
      )}
      {!error && unpinned.length > 0 && jobs.length > 0 && <div className="ops-banner" role="status">{unpinned.length} active deliver{unpinned.length > 1 ? "ies are" : "y is"} not on the map yet. Add pins in Deliveries.</div>}
      <div className="ops-wrap">
        <div className="ops-stage">
          <OpsMap agents={agents} jobs={jobs} layers={layers} selection={selection} now={now} onSelect={setSelection} />
          <div className="ops-toolbar">
            {pill("drivers", "Drivers", counts.drivers, "dot-driver")}
            {pill("suppliers", "Suppliers", counts.suppliers, "dot-supplier")}
            {pill("customers", "Customers", counts.customers, "dot-customer")}
            {pill("lateOnly", "Late only", counts.late, "dot-late")}
          </div>
          <div className="ops-fresh" role="status"><span className="live" />{`Updated ${age} s ago`}{counts.paused > 0 && <b> · {counts.paused} paused</b>}</div>
          <div className="ops-key">
            <b>Key</b>
            <span><s className="k-solid" />Delivering</span>
            <span><s className="k-pick" />Driver heading to pickup</span>
            <span><s className="k-wait" />Waiting for a driver</span>
            <span><s className="k-late" />Late</span>
            <span><u className="k-paused" />Location paused</span>
          </div>
        </div>
        <aside className="ops-side"><DetailPanel selection={selection} agents={agents} jobs={jobs} now={now} /></aside>
      </div>
      <p className="ops-note">Routes are straight lines between points, not driving routes. Distances are estimates. Map data from OpenStreetMap contributors.</p>
    </>
  );
}
