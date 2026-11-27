import { useRef, useState, type ReactNode } from "react";
import { Camera, RefreshCw } from "lucide-react";
import { imageToDataUrl } from "../../lib/photo";

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="dv-sheet" onClick={onClose} role="presentation">
      <div role="dialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 18 }}>{title}</h2>
        {children}
        <button type="button" className="dv-big soft" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

/** Rejecting or cancelling needs a short reason so the team can act on it. */
export function ReasonSheet({ title, hint, cta, busy, onSubmit, onClose }: { title: string; hint: string; cta: string; busy: boolean; onSubmit: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      <label className="dv-field">{hint}<textarea value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className="dv-big danger" disabled={busy || reason.trim().length < 3} onClick={() => onSubmit(reason.trim())}>{cta}</button>
    </Sheet>
  );
}

/** Proof of delivery: the driver photographs the delivered order. The photo is saved with the delivery. */
export function ProofSheet({ ref_, busy, onSubmit, onClose }: { ref_: string; busy: boolean; onSubmit: (photo: string) => void; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState("");
  const [err, setErr] = useState("");
  const pick = async (f?: File) => { if (!f) return; setErr(""); try { setPhoto(await imageToDataUrl(f, 1000, 0.7)); } catch (e) { setErr(e instanceof Error ? e.message : "Could not read the photo."); } };
  return (
    <Sheet title={`Proof of delivery · ${ref_}`} onClose={onClose}>
      <p className="dv-muted">Take a clear photo of the order at the customer's door or in their hands.</p>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={e => void pick(e.target.files?.[0])} />
      {photo && <img className="dv-photo" src={photo} alt="Delivery proof" />}
      {err && <p className="dv-err" role="alert">{err}</p>}
      <button type="button" className={`dv-big ${photo ? "soft" : "blue"}`} onClick={() => input.current?.click()}>{photo ? <><RefreshCw size={18} /> Retake photo</> : <><Camera size={18} /> Take photo</>}</button>
      <button type="button" className="dv-big" disabled={!photo || busy} onClick={() => onSubmit(photo)}>{busy ? "Saving…" : "Confirm delivered"}</button>
    </Sheet>
  );
}

const KINDS: [string, string][] = [["customer_unreachable", "Customer not answering"], ["wrong_address", "Wrong or unclear address"], ["vehicle_problem", "Vehicle problem"], ["safety", "Safety concern"], ["other", "Something else"]];
export function ReportSheet({ jobs, busy, onSubmit, onClose }: { jobs: { id: string; ref: string }[]; busy: boolean; onSubmit: (delivery: string | null, kind: string, note: string) => void; onClose: () => void }) {
  const [kind, setKind] = useState("customer_unreachable");
  const [d, setD] = useState(jobs[0]?.id ?? "");
  const [note, setNote] = useState("");
  return (
    <Sheet title="Report a problem" onClose={onClose}>
      <label className="dv-field">What happened?<select value={kind} onChange={e => setKind(e.target.value)}>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      {jobs.length > 0 && <label className="dv-field">Which delivery?<select value={d} onChange={e => setD(e.target.value)}>{jobs.map(j => <option key={j.id} value={j.id}>{j.ref}</option>)}<option value="">Not about one delivery</option></select></label>}
      <label className="dv-field">Details (optional)<textarea value={note} maxLength={500} onChange={e => setNote(e.target.value)} /></label>
      <button type="button" className="dv-big" disabled={busy} onClick={() => onSubmit(d || null, kind, note)}>Send to the team</button>
    </Sheet>
  );
}
