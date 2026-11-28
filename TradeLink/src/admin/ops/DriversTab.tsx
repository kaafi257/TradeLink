import { useState } from "react";
import { BadgeCheck, Banknote, Bike, Building2, Coins, HandCoins, Phone, ShieldCheck, ShieldOff, User } from "lucide-react";
import { callRpc, ErrorNote, useAction, useLoad } from "../suite";
import CitiesPanel from "./CitiesPanel";
import CashPanel from "./CashPanel";
import PayoutsPanel from "./PayoutsPanel";
import PricingPanel from "./PricingPanel";
import DriverCities from "./DriverCities";
import type { City, DriverLoad } from "./cities";
import "./ops.css";

export type DriverRow = { profileId: string; id: string | null; name: string; email: string; phone: string | null; vehicle: string; plate: string | null; verified: boolean; hasPhoto: boolean; deliveries: number };

/** Every delivery-role account, with a clear Verify button for owner and manager. */
export default function DriversTab() {
  const list = useLoad(() => callRpc<DriverRow[]>("ops_drivers"), []);
  const cities = useLoad(() => callRpc<City[]>("ops_cities").catch(() => [] as City[]), []);
  const load = useLoad(() => callRpc<DriverLoad[]>("ops_driver_load").catch(() => [] as DriverLoad[]), []);
  const [panel, setPanel] = useState<"" | "cities" | "prices" | "payouts" | "cash">("");
  const toggle = (k: typeof panel) => setPanel(v => (v === k ? "" : k));
  const ld = (id: string) => load.data?.find(x => x.profileId === id);
  const { busy, run } = useAction();
  const set = (d: DriverRow, v: boolean) => void run(() => callRpc("ops_verify_driver", { p_profile: d.profileId, p_verified: v }).then(() => list.reload()), v ? `${d.name} is verified.` : "Verification removed.");
  return (
    <div className="drs">
      <ErrorNote text={list.error} />
      <div className="drs-bar">
        <button type="button" className={`ops-pill ${panel === "cities" ? "on" : ""}`} aria-pressed={panel === "cities"} onClick={() => toggle("cities")}><Building2 size={15} /> Cities and areas{cities.data?.length ? ` (${cities.data.length})` : ""}</button>
        <button type="button" className={`ops-pill ${panel === "prices" ? "on" : ""}`} aria-pressed={panel === "prices"} onClick={() => toggle("prices")}><Coins size={15} /> Prices</button>
        <button type="button" className={`ops-pill ${panel === "payouts" ? "on" : ""}`} aria-pressed={panel === "payouts"} onClick={() => toggle("payouts")}><Banknote size={15} /> Pay and payouts</button>
        <button type="button" className={`ops-pill ${panel === "cash" ? "on" : ""}`} aria-pressed={panel === "cash"} onClick={() => toggle("cash")}><HandCoins size={15} /> Cash</button>
      </div>
      {panel === "cities" && <CitiesPanel onChanged={() => { cities.reload(); load.reload(); }} />}
      {panel === "prices" && <PricingPanel cities={cities.data ?? []} />}
      {panel === "payouts" && <PayoutsPanel />}
      {panel === "cash" && <CashPanel />}
      {list.data?.length === 0 && <p className="ops-empty">No delivery drivers yet. Add a staff member with the Delivery role in Staff Management.</p>}
      {list.data?.map(d => (
        <article className="drs-card" key={d.profileId}>
          <span className="drs-av"><User size={22} /></span>
          <div className="drs-main">
            <b>{d.name}</b>
            <small><Bike size={13} /> {d.vehicle}{d.plate ? ` · ${d.plate}` : ""} · {d.deliveries} delivered</small>
            <small>{ld(d.profileId) ? <><i className={`drs-dot ${ld(d.profileId)!.online ? "on" : ""}`} /> {ld(d.profileId)!.online ? "Online" : "Offline"} · {ld(d.profileId)!.openJobs} open job{ld(d.profileId)!.openJobs === 1 ? "" : "s"}</> : null}</small>
            <small>{d.phone ? <><Phone size={13} /> {d.phone}</> : "No phone added yet"} · {d.email}</small>
          </div>
          {cities.data && cities.data.length > 0 && <DriverCities profile={d.profileId} cities={cities.data} selected={ld(d.profileId)?.cities ?? []} onChanged={() => { load.reload(); cities.reload(); }} />}
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
