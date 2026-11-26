import type { ReactNode } from "react";
import { Phone } from "lucide-react";
import {
  AGENT_LABEL, JOB_LABEL, effectiveStatus, isLate, isOpen, km, lastSeenText, waitingMinutes,
  type Agent, type AgentStatus, type Job,
} from "./ops";
import type { Selection } from "./OpsMap";

const AGENT_TONE: Record<AgentStatus, string> = { free: "idle", to_pickup: "warn", delivering: "ok", paused: "bad", offline: "idle" };

export const Tag = ({ tone, children }: { tone: "ok" | "warn" | "bad" | "idle"; children: ReactNode }) => <span className={`ops-tag ${tone}`}>{children}</span>;

export function AgentTag({ a, now }: { a: Agent; now: number }) {
  const s = effectiveStatus(a, now);
  return <Tag tone={AGENT_TONE[s] as "ok" | "warn" | "bad" | "idle"}>{AGENT_LABEL[s]}</Tag>;
}

export function JobTag({ j, now }: { j: Job; now: number }) {
  if (isLate(j, now) && isOpen(j)) return <Tag tone="bad">Late</Tag>;
  const tone = j.status === "picked_up" || j.status === "delivered" ? "ok" : j.status === "failed" ? "bad" : "warn";
  return <Tag tone={tone}>{JOB_LABEL[j.status]}</Tag>;
}

export const money = (n: number) => `ETB ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One chain: supplier, driver, customer, for the order the admin clicked. */
export function DetailPanel({ selection, agents, jobs, now }: { selection: Selection; agents: Agent[]; jobs: Job[]; now: number }) {
  if (!selection) return <div className="ops-detail empty"><p>Select a driver, a supplier or a customer on the map to see the whole delivery.</p></div>;
  const agent = selection.kind === "agent" ? agents.find(a => a.id === selection.id) : undefined;
  const job = selection.kind === "job" ? jobs.find(j => j.id === selection.id) : jobs.find(j => j.id === agent?.jobId);
  const driver = agent ?? (job?.agentId ? agents.find(a => a.id === job.agentId) : undefined);
  if (!job && !driver) return <div className="ops-detail empty"><p>That item is no longer active.</p></div>;

  const left = job && driver?.lat != null && driver.lng != null
    ? km(driver.lat, driver.lng, job.status === "picked_up" ? job.customer.lat : job.supplier.lat, job.status === "picked_up" ? job.customer.lng : job.supplier.lng)
    : null;

  return (
    <div className="ops-detail">
      <div className="ops-detail-head">
        <div><small>{job ? "Selected order" : "Selected driver"}</small><h3>{job ? job.ref : driver!.name}</h3></div>
        {job ? <JobTag j={job} now={now} /> : <AgentTag a={driver!} now={now} />}
      </div>

      <ol className="ops-chain">
        {job && (
          <li><i className="sq" /><div><small>Supplier</small><b>{job.supplier.name}</b><span>{job.status === "waiting" || job.status === "assigned" ? `Ready for ${waitingMinutes(job, now)} min` : "Handed over"}</span></div></li>
        )}
        <li><i className="dr" /><div><small>Driver</small>
          {driver ? (<><b>{driver.name}, {driver.vehicle.toLowerCase()}</b><span>Seen {lastSeenText(driver.updatedAt, now)}{left !== null ? `, about ${left.toFixed(1)} km to go (straight line)` : ""}</span></>) : (<><b>Not assigned yet</b><span>Choose a free driver from the dispatch list</span></>)}
        </div></li>
        {job && (
          <li><i className="cu" /><div><small>Customer</small><b>{job.customer.name}, {job.customer.area}</b><span>{job.promisedAt ? `Promised by ${new Date(job.promisedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "No time promised"}</span></div></li>
        )}
      </ol>

      {job && (
        <dl className="ops-facts">
          <div><dt>Goods</dt><dd>{job.items}</dd></div>
          <div><dt>Delivery fee</dt><dd>{money(job.fee)}</dd></div>
          {job.distanceKm !== null && <div><dt>Estimated distance</dt><dd>{job.distanceKm.toFixed(1)} km</dd></div>}
        </dl>
      )}

      {driver && driver.phone && <a className="btn outline ops-call" href={`tel:${driver.phone.replace(/\s/g, "")}`}><Phone size={16} /> Call {driver.name.split(" ")[0]}</a>}
    </div>
  );
}
