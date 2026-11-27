import { BadgeCheck, Bike, Phone, ShieldCheck, ShieldOff, User } from "lucide-react";
import { callRpc, ErrorNote, useAction, useLoad } from "../suite";
import "./ops.css";

export type DriverRow = { profileId: string; id: string | null; name: string; email: string; phone: string | null; vehicle: string; plate: string | null; verified: boolean; hasPhoto: boolean; deliveries: number };

/** Every delivery-role account, with a clear Verify button for owner and manager. */
export default function DriversTab() {
  const list = useLoad(() => callRpc<DriverRow[]>("ops_drivers"), []);
  const { busy, run } = useAction();
  const set = (d: DriverRow, v: boolean) => void run(() => callRpc("ops_verify_driver", { p_profile: d.profileId, p_verified: v }).then(() => list.reload()), v ? `${d.name} is verified.` : "Verification removed.");
  return (
    <div className="drs">
      <ErrorNote text={list.error} />
      {list.data?.length === 0 && <p className="ops-empty">No delivery drivers yet. Add a staff member with the Delivery role in Staff Management.</p>}
      {list.data?.map(d => (
        <article className="drs-card" key={d.profileId}>
          <span className="drs-av"><User size={22} /></span>
          <div className="drs-main">
            <b>{d.name}</b>
            <small><Bike size={13} /> {d.vehicle}{d.plate ? ` · ${d.plate}` : ""} · {d.deliveries} delivered</small>
            <small>{d.phone ? <><Phone size={13} /> {d.phone}</> : "No phone added yet"} · {d.email}</small>
          </div>
          <div className="drs-act">
            <span className={`drs-chip ${d.verified ? "ok" : ""}`}>{d.verified ? <><BadgeCheck size={14} /> Verified</> : "Not verified"}</span>
            <button type="button" className={`drs-btn ${d.verified ? "off" : ""}`} disabled={busy} onClick={() => set(d, !d.verified)}>
              {d.verified ? <><ShieldOff size={16} /> Remove</> : <><ShieldCheck size={16} /> Verify driver</>}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
