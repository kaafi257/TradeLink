import { useState, type ReactNode } from "react";
import { Camera, Check, Home, MapPin, Navigation, Package, PhoneCall, Play, Store, X } from "lucide-react";
import { callRpc } from "../suite";
import { distanceKm } from "../../lib/gps";
import { useAdmin } from "../AdminData";
import { FAIL_KINDS, ProofSheet, ReasonSheet } from "./Sheets";
import { etb, navUrl, type Ctx, type Job } from "./types";

const STEP = (j: Job) => (j.status === "in_transit" ? 4 : j.pickedUp ? 3 : j.accepted ? 2 : 1);
const LABEL = ["", "New request", "Accepted", "Picked up", "On the way"];

/** One delivery with its next step as a big button. New requests are answered with Accept or Decline. */
export default function JobCard({ j, c, due }: { j: Job; c: Ctx; due?: ReactNode }) {
  const [sheet, setSheet] = useState<"" | "reject" | "cancel" | "proof">("");
  const { notify } = useAdmin();
  const step = STEP(j);
  const target = j.status === "assigned" ? j.supplier : j.dropoff;
  const km = c.here && target ? distanceKm(c.here[0], c.here[1], target.lat, target.lng) : null;
  const needGps = !c.online || !c.here;
  const run = (fn: () => Promise<unknown>, done: string) => c.act(() => fn().then(() => c.reload()), done);
  // The server checks the customer's code. A wrong code comes back as a message (and is counted); only a right one completes the delivery.
  const finish = async (photo: string, code: string): Promise<string | null> => {
    let message = null as string | null;
    const ok = await c.act(async () => {
      const r = await callRpc<{ ok: boolean; message?: string }>("driver_complete", { p_delivery: j.id, p_photo: photo, p_code: code });
      if (!r?.ok) { message = r?.message ?? "That code was not accepted."; return; }
      c.reload();
    });
    if (!ok) return "Could not confirm. Check your connection and try again.";
    if (message) return message;
    notify("Delivered. Well done!"); setSheet("");
    return null;
  };

  return (
    <article className="dv-card">
      <div className="dv-job-top"><span className="dv-ref">{j.ref}</span><span className={`dv-pill ${step === 1 ? "warn" : ""}`}>{LABEL[step]}</span></div>
      <div className="dv-steps" aria-hidden>{[1, 2, 3, 4].map(n => <i key={n} className={n <= step ? "on" : ""} />)}</div>
      <div className="dv-route">
        <div className="dv-stop"><span className="ic"><Store size={17} /></span><div><b>{j.supplier?.name ?? "Pickup"}</b><small>{j.supplier ? "Pickup point" : "Pickup point not set yet"}</small></div></div>
        <div className="dv-stop"><span className="ic c"><Home size={17} /></span><div><b>{j.customer}</b><small>{j.address}{j.notes ? ` · ${j.notes}` : ""}</small></div></div>
      </div>
      <p className="dv-muted"><Package size={14} style={{ verticalAlign: -2 }} /> {j.items}</p>
      <div className="dv-row" style={{ alignItems: "center" }}>
        <span className="dv-money">{j.fee != null ? `Pay ${etb(j.fee)}` : "Pay not set yet"}</span>
        {km != null && <span className="dv-muted" style={{ textAlign: "right" }}>{km.toFixed(1)} km away</span>}
      </div>
      {due}

      {step === 1 && (
        <div className="dv-row">
          <button type="button" className="dv-big danger" disabled={c.busy} onClick={() => setSheet("reject")}><X size={18} /> Decline</button>
          <button type="button" className="dv-big" disabled={c.busy} onClick={() => void run(() => callRpc("driver_respond", { p_delivery: j.id, p_accept: true }), "Delivery accepted.")}><Check size={18} /> Accept</button>
        </div>
      )}
      {step >= 2 && (
        <div className="dv-row">
          {target && <a className="dv-big soft" href={navUrl(target)} target="_blank" rel="noopener noreferrer"><Navigation size={18} /> Navigate</a>}
          {j.phone && <a className="dv-big soft" href={`tel:${j.phone}`}><PhoneCall size={18} /> Call</a>}
        </div>
      )}
      {step === 2 && <button type="button" className="dv-big blue" disabled={c.busy} onClick={() => void run(() => callRpc("driver_mark_picked_up", { p_delivery: j.id }), "Marked as picked up.")}><Package size={18} /> I picked up the order</button>}
      {step === 3 && <button type="button" className="dv-big" disabled={c.busy || needGps} onClick={() => void run(() => callRpc("driver_start", { p_delivery: j.id }), "Trip started.")}><Play size={18} /> {needGps ? "Go online with GPS to start" : "Start trip to customer"}</button>}
      {step === 4 && <button type="button" className="dv-big" disabled={c.busy} onClick={() => setSheet("proof")}><Camera size={18} /> Delivered · enter code</button>}
      {step >= 2 && <button type="button" className="dv-big danger" disabled={c.busy} onClick={() => setSheet("cancel")}><MapPin size={18} /> Cannot deliver</button>}

      {sheet === "reject" && <ReasonSheet title="Decline this delivery" hint="Why can't you take it?" cta="Decline delivery" busy={c.busy} onClose={() => setSheet("")}
        onSubmit={r => void run(() => callRpc("driver_respond", { p_delivery: j.id, p_accept: false, p_reason: r }), "Declined. The team will reassign it.").then(() => setSheet(""))} />}
      {sheet === "cancel" && <ReasonSheet title="Cannot deliver" hint="What went wrong?" cta="Cancel this delivery" busy={c.busy} categories={FAIL_KINDS} onClose={() => setSheet("")}
        onSubmit={(r, k) => void run(() => callRpc("driver_fail", { p_delivery: j.id, p_reason: r, p_category: k ?? "other" }), "Reported to the team.").then(() => setSheet(""))} />}
      {sheet === "proof" && <ProofSheet ref_={j.ref} busy={c.busy} onClose={() => setSheet("")}
        onSubmit={finish} />}
    </article>
  );
}
