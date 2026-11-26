import { useState } from "react";
import { Check, Crosshair, Loader2 } from "lucide-react";
import { getFix, type Fix } from "../lib/gps";
import "./ShareLocation.css";

/** A button that asks for the device GPS and shows the result. The parent keeps the fix. */
export default function ShareLocation({ fix, onFix, label, doneLabel, className = "" }: { fix: Fix | null; onFix: (f: Fix) => void; label: string; doneLabel: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true); setErr("");
    try { onFix(await getFix()); } catch (e) { setErr(e instanceof Error ? e.message : "Could not get your location."); } finally { setBusy(false); }
  };
  return (
    <div className={`gps-share ${fix ? "ok" : ""} ${className}`}>
      <button type="button" onClick={() => void go()} disabled={busy}>
        {busy ? <Loader2 size={16} className="gps-spin" /> : fix ? <Check size={16} /> : <Crosshair size={16} />}
        {busy ? "Finding your location…" : fix ? doneLabel : label}
      </button>
      {fix && <small>GPS saved · accuracy about {fix.accuracy} m{fix.accuracy > 150 ? ". Move outside or near a window and press again for a better fix." : ""}</small>}
      {err && <small className="gps-err" role="alert">{err}</small>}
    </div>
  );
}
