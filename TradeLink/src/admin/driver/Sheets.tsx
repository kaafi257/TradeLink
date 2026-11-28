import { useRef, useState, type ReactNode } from "react";
import { Camera, KeyRound, RefreshCw } from "lucide-react";
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

export const FAIL_KINDS: [string, string][] = [["customer_unreachable", "Customer not answering"], ["wrong_address", "Wrong or unclear address"], ["customer_refused", "Customer refused the order"], ["driver_problem", "My vehicle or safety problem"], ["other", "Something else"]];

/** Rejecting or cancelling needs a short reason so the team can act on it. With `categories`, the driver also picks what kind of problem it was. */
export function ReasonSheet({ title, hint, cta, busy, categories, onSubmit, onClose }: { title: string; hint: string; cta: string; busy: boolean; categories?: [string, string][]; onSubmit: (reason: string, category?: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [cat, setCat] = useState("");
  return (
    <Sheet title={title} onClose={onClose}>
      {categories && (
        <div className="dv-cats" role="radiogroup" aria-label="What kind of problem">
          {categories.map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={cat === k} className={`dv-cat ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>{v}</button>)}
        </div>
      )}
      <label className="dv-field">{hint}<textarea value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label>
      <button type="button" className="dv-big danger" disabled={busy || reason.trim().length < 3 || (!!categories && !cat)} onClick={() => onSubmit(reason.trim(), cat || undefined)}>{cta}</button>
    </Sheet>
  );
}

/** Completing a delivery: the customer's 6-digit code, plus a photo of the delivered order as extra proof. The server checks the code. */
export function ProofSheet({ ref_, busy, onSubmit, onClose }: { ref_: string; busy: boolean; onSubmit: (photo: string, code: string) => Promise<string | null>; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [sending, setSending] = useState(false);
  const pick = async (f?: File) => { if (!f) return; setErr(""); try { setPhoto(await imageToDataUrl(f, 1000, 0.7)); } catch (e) { setErr(e instanceof Error ? e.message : "Could not read the photo."); } };
  const send = async () => {
    setSending(true); setErr("");
    const m = await onSubmit(photo, code);
    setSending(false);
    if (m) { setErr(m); setCode(""); }
  };
  return (
    <Sheet title={`Confirm delivery · ${ref_}`} onClose={onClose}>
      <label className="dv-field"><span><KeyRound size={14} style={{ verticalAlign: -2 }} /> Customer's 6-digit code</span>
        <input className="dv-code" inputMode="numeric" pattern="[0-9]*" autoComplete="off" maxLength={6} placeholder="• • • • • •" value={code} aria-label="Customer's 6-digit code" onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} />
      </label>
      <p className="dv-muted">Ask the customer for the code once they have their order. It is on their phone.</p>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={e => void pick(e.target.files?.[0])} />
      {photo && <img className="dv-photo" src={photo} alt="Delivery proof" />}
      {err && <p className="dv-err" role="alert">{err}</p>}
      <button type="button" className={`dv-big ${photo ? "soft" : "blue"}`} onClick={() => input.current?.click()}>{photo ? <><RefreshCw size={18} /> Retake photo</> : <><Camera size={18} /> Take photo of the order</>}</button>
      <button type="button" className="dv-big" disabled={!photo || code.length !== 6 || busy || sending} onClick={() => void send()}>{sending ? "Checking…" : "Confirm delivered"}</button>
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
