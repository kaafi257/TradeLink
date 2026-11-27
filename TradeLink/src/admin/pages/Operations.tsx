import { callRpc, useLoad } from "../suite";
import { useMemo, useState } from "react";
import { PageHeading } from "../../components/ui";
import { useOpsData, effectiveStatus, isLate, isOpen, lastSeenText, waitingMinutes, JOB_LABEL, type Agent, type Job } from "../ops/ops";
import { AgentTag, JobTag, Tag } from "../ops/parts";
import "../ops/ops.css";

export default function Operations({ embedded = false }: { embedded?: boolean }) {
  const { snapshot, unpinned, loading, error, now } = useOpsData();
  const drv = useLoad(() => callRpc<{ id: string; verified: boolean }[]>("ops_drivers").catch(() => []), [snapshot.agents.length]);
  const verified = (id: string) => !!drv.data?.find(d => d.id === id)?.verified;
  const setVerified = (id: string, v: boolean) => void callRpc("ops_set_driver_verified", { p_agent: id, p_verified: v }).then(() => drv.reload());
  const [q, setQ] = useState("");
  const [lateOnly, setLateOnly] = useState(false);
  const s = q.trim().toLowerCase();

  const open = useMemo(() => snapshot.jobs.filter(isOpen), [snapshot.jobs]);
  const byId = useMemo(() => new Map(snapshot.agents.map(a => [a.id, a])), [snapshot.agents]);

  const agents = snapshot.agents.filter(a => `${a.name} ${a.vehicle}`.toLowerCase().includes(s))
    .sort((a, b) => Number(effectiveStatus(a, now) === "offline") - Number(effectiveStatus(b, now) === "offline") || a.name.localeCompare(b.name));
  const suppliers = open.filter(j => (j.status === "waiting" || j.status === "assigned") && `${j.supplier.name} ${j.ref} ${j.items}`.toLowerCase().includes(s) && (!lateOnly || isLate(j, now)))
    .sort((a, b) => waitingMinutes(b, now) - waitingMinutes(a, now));
  const customers = open.filter(j => `${j.customer.name} ${j.customer.area} ${j.ref}`.toLowerCase().includes(s) && (!lateOnly || isLate(j, now)))
    .sort((a, b) => Number(isLate(b, now)) - Number(isLate(a, now)) || waitingMinutes(b, now) - waitingMinutes(a, now));

  const online = snapshot.agents.filter(a => a.status !== "offline");
  const stat = (label: string, n: number, tone = "") => <div className={`ops-stat ${tone}`}><span>{label}</span><b>{n}</b></div>;
  const driverFor = (j: Job): Agent | undefined => (j.agentId ? byId.get(j.agentId) : undefined);

  return (
    <>
      {!embedded && (
      <PageHeading title="Operations" sub="Everyone and every package right now: drivers, suppliers and customers waiting." />
      )}
      {error && <div className="ops-banner" role="alert">{error}</div>}
      {!error && !loading && unpinned.length > 0 && <div className="ops-banner" role="status">{unpinned.length} active deliver{unpinned.length > 1 ? "ies have" : "y has"} no map pins yet: {unpinned.map(u => u.ref).join(", ")}. Add pins in Deliveries.</div>}

      <div className="ops-stats">
        {stat("Drivers online", online.length)}
        {stat("Suppliers with a pickup", new Set(open.filter(j => j.status === "waiting" || j.status === "assigned").map(j => j.supplier.name)).size)}
        {stat("Customers waiting", open.length)}
        {stat("Late", open.filter(j => isLate(j, now)).length, "bad")}
        {stat("Location paused", snapshot.agents.filter(a => effectiveStatus(a, now) === "paused").length, "warn")}
      </div>

      <div className="ops-filter">
        <input aria-label="Search drivers, suppliers or customers" placeholder="Search driver, supplier, customer or order number" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className={`ops-pill ${lateOnly ? "on" : ""}`} aria-pressed={lateOnly} onClick={() => setLateOnly(v => !v)}>Late only</button>
      </div>

      <div className="ops-cols">
        <section className="ops-col" aria-label="Drivers">
          <h2>Drivers <small>{online.length} online</small></h2>
          {agents.length === 0 && <p className="ops-empty">No drivers match.</p>}
          {agents.map(a => {
            const job = a.jobId ? snapshot.jobs.find(j => j.id === a.jobId) : undefined;
            return (
              <div className="ops-row" key={a.id}>
                <div className="top"><b>{a.name}</b><AgentTag a={a} now={now} /></div>
                <button type="button" className="ops-tag" style={{ cursor: "pointer", border: 0, justifySelf: "start" }} onClick={() => setVerified(a.id, !verified(a.id))}>{verified(a.id) ? "Verified · tap to remove" : "Tap to verify driver"}</button>
                <small>{a.vehicle}. {job ? `Order ${job.ref} to ${job.customer.area}. ` : "No job. "}{a.status === "offline" ? "" : `Seen ${lastSeenText(a.updatedAt, now)}.`}</small>
              </div>
            );
          })}
        </section>

        <section className="ops-col" aria-label="Suppliers">
          <h2>Suppliers <small>packages to hand over</small></h2>
          {suppliers.length === 0 && <p className="ops-empty">Nothing is waiting at a supplier.</p>}
          {suppliers.map(j => {
            const d = driverFor(j);
            return (
              <div className="ops-row" key={j.id}>
                <div className="top"><b>{j.supplier.name}</b>{d ? <Tag tone="warn">Driver coming</Tag> : <Tag tone="bad">No driver yet</Tag>}</div>
                <small>{j.items}. Ready for {waitingMinutes(j, now)} min. Order {j.ref}.{d ? ` ${d.name} is on the way.` : ""}</small>
              </div>
            );
          })}
        </section>

        <section className="ops-col" aria-label="Customers waiting">
          <h2>Customers waiting <small>{open.length} orders</small></h2>
          {customers.length === 0 && <p className="ops-empty">No customers are waiting.</p>}
          {customers.map(j => {
            const d = driverFor(j);
            return (
              <div className="ops-row" key={j.id}>
                <div className="top"><b>{j.customer.name}, {j.customer.area}</b><JobTag j={j} now={now} /></div>
                <small>Order {j.ref}. {JOB_LABEL[j.status]}{d ? `, driver ${d.name}` : ""}.{j.promisedAt ? ` Promised by ${new Date(j.promisedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : ""}</small>
              </div>
            );
          })}
        </section>
      </div>
    </>
  );
}
