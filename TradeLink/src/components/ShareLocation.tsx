import { lazy, Suspense, useState } from "react";
import { Check, Crosshair, Loader2 } from "lucide-react";
import { getBestFix, type Fix } from "../lib/gps";
import "./ShareLocation.css";

const PinAdjust = lazy(() => import("./PinAdjust"));

/**
 * Asks for the device GPS, waits for an accurate reading, then lets the person drag the pin onto the exact spot.
 * Without `confirm`, every change is reported through onFix. With `confirm`, a Save button sends the final spot.
 */
export default function ShareLocation({ fix, onFix, confirm, label, doneLabel, maxAccuracy = 150, className = "" }: {
  fix: Fix | null; onFix: (f: Fix) => void; confirm?: (f: Fix) => void | Promise<void>; label: string; doneLabel: string; maxAccuracy?: number; className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<number | null>(null);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Fix | null>(null);
  const shown = confirm ? draft : fix;

  const go = async () => {
    setBusy(true); setErr(""); setSeen(null);
    try {
      const f = await getBestFix({ targetM: 30, maxMs: 25000, onProgress: setSeen });
      if (f.accuracy > maxAccuracy) { setErr(`Your GPS is only accurate to about ${f.accuracy} m. Go outside or near a window, make sure GPS (high accuracy) is on, and try again.`); return; }
      if (confirm) setDraft(f); else onFix(f);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not get your location."); } finally { setBusy(false); }
  };
  const moved = (p: { lat: number; lng: number }) => { const base = shown ?? { lat: p.lat, lng: p.lng, accuracy: 10 }; const f = { ...base, lat: p.lat, lng: p.lng }; if (confirm) setDraft(f); else onFix(f); };
  const save = async () => { if (!draft) return; setBusy(true); try { await confirm!(draft); setDraft(null); } finally { setBusy(false); } };

  return (
    <div className={`gps-share ${fix ? "ok" : ""} ${className}`}>
      <button type="button" onClick={() => void go()} disabled={busy}>
        {busy ? <Loader2 size={16} className="gps-spin" /> : fix && !confirm ? <Check size={16} /> : <Crosshair size={16} />}
        {busy ? (seen != null ? `Improving accuracy… about ${seen} m` : "Finding your location…") : fix && !confirm ? doneLabel : label}
      </button>
      {err && <small className="gps-err" role="alert">{err}</small>}
      {shown && (
        <>
          <small>GPS accuracy about {shown.accuracy} m. Drag the pin onto the exact spot, then {confirm ? "press Save" : "continue"}.</small>
          <Suspense fallback={<small>Loading map…</small>}><PinAdjust lat={shown.lat} lng={shown.lng} onMove={moved} /></Suspense>
          {confirm && <button type="button" onClick={() => void save()} disabled={busy}><Check size={16} /> Save this location</button>}
        </>
      )}
    </div>
  );
}
