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
  const [byHand, setByHand] = useState(false);
  const rough = !!draft && draft.accuracy > maxAccuracy && !byHand;

  const go = async () => {
    setBusy(true); setErr(""); setSeen(null); setByHand(false);
    try {
      const f = await getBestFix({ targetM: 30, maxMs: 25000, onProgress: setSeen });
      setDraft(f);
      // A reading that is accurate enough is used straight away. A rough one is only a starting point: the person must place the pin by hand.
      if (f.accuracy <= maxAccuracy && !confirm) onFix(f);
    } catch (e) { setErr(e instanceof Error ? e.message : "Could not get your location."); } finally { setBusy(false); }
  };
  const moved = (p: { lat: number; lng: number }) => {
    const f: Fix = { lat: p.lat, lng: p.lng, accuracy: 5 };   // placed by hand on the map: exact to the pin
    setByHand(true); setDraft(f); if (!confirm) onFix(f);
  };
  const save = async () => { if (!draft || rough) return; setBusy(true); try { await confirm!(draft); setDraft(null); setByHand(false); } finally { setBusy(false); } };
  const ready = !!draft && !rough;

  return (
    <div className={`gps-share ${ready ? "ok" : ""} ${className}`}>
      <button type="button" onClick={() => void go()} disabled={busy}>
        {busy ? <Loader2 size={16} className="gps-spin" /> : ready && !confirm ? <Check size={16} /> : <Crosshair size={16} />}
        {busy ? (seen != null ? `Improving accuracy… about ${seen} m` : "Finding your location…") : ready && !confirm ? doneLabel : label}
      </button>
      {!draft && !busy && <small>For the best result choose <b>Precise</b> location when your phone asks, turn on GPS, and stand outside or by a window.</small>}
      {err && <small className="gps-err" role="alert">{err}</small>}
      {draft && (
        <>
          {rough
            ? <small className="gps-err">Your phone could only find you within about {draft.accuracy} m, so this is not exact. Zoom in and drag the pin onto the exact spot (your shop door or where you want the delivery).</small>
            : <small>{byHand ? "Pin placed by hand." : `GPS accuracy about ${draft.accuracy} m.`} Drag the pin if it is not on the exact spot{confirm ? ", then press Save" : ""}.</small>}
          <Suspense fallback={<small>Loading map…</small>}><PinAdjust lat={draft.lat} lng={draft.lng} radius={byHand ? 0 : draft.accuracy} onMove={moved} /></Suspense>
          {confirm && <button type="button" onClick={() => void save()} disabled={busy || rough}><Check size={16} /> {rough ? "Place the pin first" : "Save this location"}</button>}
        </>
      )}
    </div>
  );
}
