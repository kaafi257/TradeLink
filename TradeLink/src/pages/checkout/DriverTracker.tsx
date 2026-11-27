import { lazy, Suspense, useEffect, useState } from "react";
import { BadgeCheck, Bike, PackageCheck, Truck } from "lucide-react";
import { supabase } from "../../lib/supabase";

const TrackMap = lazy(() => import("./TrackMap"));
type T = { stage: string; driverName?: string; vehicle?: string; verified?: boolean; lat?: number | null; lng?: number | null; updatedAt?: string | null; dropLat?: number | null; dropLng?: number | null };
const STAGES: [string, string][] = [["assigned", "Driver assigned"], ["accepted", "Driver accepted"], ["picked_up", "Picked up"], ["on_the_way", "On the way"], ["delivered", "Delivered"]];

/** Shows the customer where the delivery is. The driver's live position appears only while the order is on the way. */
export default function DriverTracker({ number, phone }: { number: string; phone: string }) {
  const [t, setT] = useState<T | null>(null);
  useEffect(() => {
    if (!supabase || !phone) return;
    let stop = false;
    const load = async () => {
      const { data } = await supabase!.rpc("track_driver", { p_number: number, p_phone: phone });
      if (!stop) setT((data ?? null) as T | null);
    };
    void load();
    const id = window.setInterval(() => void load(), 10000);
    return () => { stop = true; window.clearInterval(id); };
  }, [number, phone]);
  if (!t || t.stage === "preparing") return null;
  const at = Math.max(0, STAGES.findIndex(s => s[0] === t.stage));
  const fresh = t.updatedAt ? Date.now() - new Date(t.updatedAt).getTime() < 120000 : false;
  return (
    <section className="co-card">
      <h2><Truck size={18} style={{ verticalAlign: -3 }} /> Delivery tracking</h2>
      <ol className="co-track" aria-label="Delivery progress">{STAGES.map(([k, v], i) => <li key={k} className={i <= at ? "on" : ""}>{v}</li>)}</ol>
      {t.stage === "on_the_way" && (
        <>
          <p className="co-note"><Bike size={15} /> {t.driverName ?? "Your driver"} is bringing your order{t.vehicle ? ` by ${t.vehicle.toLowerCase()}` : ""}. {t.verified && <span><BadgeCheck size={14} style={{ verticalAlign: -2 }} /> Verified driver</span>}</p>
          {t.lat != null && t.lng != null && fresh
            ? <Suspense fallback={<p className="co-note">Loading map…</p>}><TrackMap driver={[t.lat, t.lng]} drop={t.dropLat != null && t.dropLng != null ? [t.dropLat, t.dropLng] : null} /></Suspense>
            : <p className="co-note">The driver's live location is not available right now. It will appear here as soon as their phone reports it.</p>}
        </>
      )}
      {t.stage === "delivered" && <p className="co-note"><PackageCheck size={15} /> Your order was delivered. Thank you!</p>}
    </section>
  );
}
