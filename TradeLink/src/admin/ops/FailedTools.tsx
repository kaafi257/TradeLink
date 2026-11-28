import { useRef, useState } from "react";
import { Camera, KeyRound, RefreshCw, ShieldAlert, Truck } from "lucide-react";
import { imageToDataUrl } from "../../lib/photo";
import type { DeliveryRow } from "../../lib/supabase";
import { Form, Modal, callRpc, useAction, useLoad } from "../suite";
import { byAvailability, type Candidates } from "./cities";

export const FAIL_KINDS: [string, string][] = [["customer_unreachable", "Customer not answering"], ["wrong_address", "Wrong or unclear address"], ["customer_refused", "Customer refused the order"], ["driver_problem", "Driver problem"], ["other", "Something else"]];
export const failLabel = (k?: string | null) => FAIL_KINDS.find(f => f[0] === k)?.[1] ?? "";
const ref = (d: DeliveryRow) => d.orders?.order_number ?? "Delivery";

/** The person assigned to the delivery completes it with the customer's code and a photo. */
export function CodeModal({ d, onClose, onDone }: { d: DeliveryRow; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => {
    setErr("");
    let msg = "";
    const ok = await run(async () => {
      const r = await callRpc<{ ok: boolean; message?: string }>("driver_complete", { p_delivery: d.id, p_photo: photo, p_code: code });
      if (!r?.ok) msg = r?.message ?? "That code was not accepted.";
    });
    if (!ok) return;
    if (msg) { setErr(msg); setCode(""); return; }
    onDone();
  };
  return (
    <Modal title={ref(d)} kicker="CONFIRM DELIVERY" onClose={onClose}>
      <div className="su-form">
        <label><span><KeyRound size={14} style={{ verticalAlign: -2 }} /> Customer's 6-digit code</span>
          <input inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={6} value={code} autoFocus onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
        </label>
        <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) try { setPhoto(await imageToDataUrl(f, 1000, 0.7)); } catch { setErr("Could not read the photo."); } }} />
        {photo && <img src={photo} alt="Delivery proof" style={{ width: "100%", borderRadius: 12 }} />}
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="button" className="btn" onClick={() => input.current?.click()}>{photo ? <><RefreshCw size={16} /> Retake photo</> : <><Camera size={16} /> Take photo</>}</button>
        <button type="button" className="btn green" disabled={busy || !photo || code.length !== 6} onClick={() => void submit()}>{busy ? "Checking…" : "Confirm delivered"}</button>
      </div>
    </Modal>
  );
}

/** Manager override: delivered without the code. Needs a written reason and is recorded permanently. */
export function OverrideModal({ d, onClose, onDone }: { d: DeliveryRow; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [reason, setReason] = useState("");
  return (
    <Modal title={ref(d)} kicker="OVERRIDE: DELIVERED" onClose={onClose}>
      <p className="asg-note"><ShieldAlert size={16} /> <span>Use this only when the customer's code could not be used. Your name, the time and your reason are recorded permanently.</span></p>
      <Form onSubmit={() => void run(() => callRpc("ops_override_delivered", { p_delivery: d.id, p_reason: reason.trim() }), "Marked delivered (override recorded).").then(ok => { if (ok) onDone(); })} busy={busy} submit="Mark delivered">
        <label>Reason (at least 10 characters)<textarea rows={3} maxLength={300} required minLength={10} value={reason} onChange={e => setReason(e.target.value)} autoFocus /></label>
      </Form>
    </Modal>
  );
}

/** Failed delivery: what kind of problem, and a short note. Managers use the ops function, a driver-staff member the driver one. */
export function FailModal({ d, manager, onClose, onDone }: { d: DeliveryRow; manager: boolean; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [cat, setCat] = useState("");
  const [reason, setReason] = useState("");
  const go = () => run(() => manager
    ? callRpc("ops_fail_delivery", { p_delivery: d.id, p_category: cat, p_reason: reason.trim() })
    : callRpc("driver_fail", { p_delivery: d.id, p_reason: reason.trim(), p_category: cat }), "Marked as failed.").then(ok => { if (ok) onDone(); });
  return (
    <Modal title={ref(d)} kicker="FAILED DELIVERY" onClose={onClose}>
      <div className="su-form">
        <div className="dv-cats" role="radiogroup" aria-label="What kind of problem" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {FAIL_KINDS.map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={cat === k} className={`btn ${cat === k ? "green" : ""}`} onClick={() => setCat(k)}>{v}</button>)}
        </div>
        <label>What happened<textarea rows={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>
        <button type="button" className="btn red" disabled={busy || !cat || reason.trim().length < 3} onClick={() => void go()}>{busy ? "Saving…" : "Mark failed"}</button>
      </div>
    </Modal>
  );
}

/** Retry a failed delivery, or move one that has not been picked up to another driver. The city rule is checked by the database. */
export function ReassignModal({ d, onClose, onDone }: { d: DeliveryRow; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [who, setWho] = useState("");
  const [notes, setNotes] = useState("");
  const cands = useLoad(() => callRpc<Candidates>("ops_assign_candidates", { p_order: d.order_id }), [d.order_id]);
  const rows = [...(cands.data?.drivers ?? [])].filter(x => x.profileId !== d.assigned_to || d.status === "failed").sort(byAvailability);
  return (
    <Modal title={ref(d)} kicker={d.status === "failed" ? "RETRY DELIVERY" : "REASSIGN"} onClose={onClose}>
      <div className="su-form">
        {cands.data?.cityName && <p className="asg-note"><span>Drivers who serve <b>{cands.data.cityName}</b>.</span></p>}
        <div className="asg-list" role="radiogroup" aria-label="Driver">
          {rows.map(c => (
            <button key={c.profileId} type="button" role="radio" aria-checked={who === c.profileId} className={`asg-row ${who === c.profileId ? "on" : ""}`} onClick={() => setWho(c.profileId)}>
              <Truck size={18} aria-hidden="true" />
              <span className="grow"><b>{c.name}</b><small>{c.role !== "delivery" ? "Office staff" : <><i className={`drs-dot ${c.online ? "on" : ""}`} /> {c.online ? "Online" : "Offline"} · {c.openJobs} open job{c.openJobs === 1 ? "" : "s"}</>}</small></span>
            </button>
          ))}
        </div>
        {!rows.length && !cands.loading && <p className="form-error" role="alert">No driver is available for this city.</p>}
        <label>Notes<textarea rows={2} maxLength={500} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <button type="button" className="btn green" disabled={busy || !who} onClick={() => void run(() => callRpc("ops_reassign_delivery", { p_delivery: d.id, p_assignee: who, p_scheduled: null, p_notes: notes }), "Delivery given to the new driver.").then(ok => { if (ok) onDone(); })}>{busy ? "Saving…" : d.status === "failed" ? "Retry with this driver" : "Reassign"}</button>
      </div>
    </Modal>
  );
}

/** Issues a fresh code (for a lost or locked one). The code is shown once. */
export function ReissueModal({ d, onClose, onDone }: { d: DeliveryRow; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [code, setCode] = useState("");
  return (
    <Modal title={ref(d)} kicker="NEW DELIVERY CODE" onClose={onClose}>
      {code ? (
        <div className="su-form">
          <p className="su-muted">Give this code to the customer. It is shown only now and the old one stops working.</p>
          <p style={{ font: "800 40px 'DM Sans',sans-serif", letterSpacing: ".3em", textAlign: "center", color: "#0b1f3a", margin: 0 }} aria-live="polite">{code}</p>
          <button type="button" className="btn green" onClick={onDone}>Done</button>
        </div>
      ) : (
        <div className="su-form">
          <p className="su-muted">Use this when the customer lost the code or it got locked after wrong tries. The old code stops working, and the change is recorded.</p>
          <button type="button" className="btn green" disabled={busy} onClick={() => void run(async () => { setCode(await callRpc<string>("ops_reissue_otp", { p_delivery: d.id })); })}>{busy ? "Working…" : <><KeyRound size={16} /> Issue new code</>}</button>
        </div>
      )}
    </Modal>
  );
}
