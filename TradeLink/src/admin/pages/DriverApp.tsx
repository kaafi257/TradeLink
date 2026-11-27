import { useCallback, useEffect, useRef, useState } from "react";
import { Home, Truck, User, Wallet } from "lucide-react";
import { callRpc, ErrorNote, useAction, useLoad } from "../suite";
import { getFix } from "../../lib/gps";
import { EarnTab, HomeTab, JobsTab, ProfileTab } from "../driver/Tabs";
import type { Ctx, Mine } from "../driver/types";
import "../ops/ops.css";
import "../driver/driver.css";

type Tab = "home" | "jobs" | "earn" | "me";

/** The driver app: Home, Deliveries, Earnings, Profile. Built for one hand: big buttons, one next step per delivery. */
export default function DriverApp() {
  const mine = useLoad(() => callRpc<Mine>("driver_my_jobs"), []);
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Tab>("home");
  const [here, setHere] = useState<[number, number] | null>(null);
  const [gps, setGps] = useState("");
  const last = useRef(0);
  const online = !!mine.data?.online;

  // While online the phone shares its position every few seconds.
  useEffect(() => {
    if (!online) return;
    if (!navigator.geolocation) { setGps("This phone cannot share its location."); return; }
    const id = navigator.geolocation.watchPosition(
      pos => {
        setGps(""); setHere([pos.coords.latitude, pos.coords.longitude]);
        if (Date.now() - last.current < 8000) return;
        last.current = Date.now();
        void callRpc("agent_report_location", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_heading: pos.coords.heading ?? null, p_accuracy: pos.coords.accuracy ?? null }).catch(() => {});
      },
      err => setGps(err.code === 1 ? "Location is off. Turn on GPS and allow location for this site so the team and customers can see you." : "Could not get your location."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [online]);

  useEffect(() => { const t = window.setInterval(() => mine.reload(), 12000); return () => window.clearInterval(t); }, [mine.reload]);

  const toggle = useCallback(() => void run(async () => {
    if (!online) { const f = await getFix(); setHere([f.lat, f.lng]); }
    await callRpc("driver_set_online", { p_online: !online });
    if (online) setHere(null);
    mine.reload();
  }), [online, run, mine]);

  const ctx: Ctx = { mine: mine.data, online, here, gps, busy, reload: mine.reload, toggle, act: run, go: setTab };
  const offers = (mine.data?.jobs ?? []).filter(j => !j.accepted && j.status === "assigned").length;
  const items: [Tab, string, typeof Home][] = [["home", "Home", Home], ["jobs", "Deliveries", Truck], ["earn", "Earnings", Wallet], ["me", "Profile", User]];
  return (
    <div className="dv">
      <ErrorNote text={mine.error} />
      {tab === "home" && <HomeTab c={ctx} />}
      {tab === "jobs" && <JobsTab c={ctx} />}
      {tab === "earn" && <EarnTab />}
      {tab === "me" && <ProfileTab c={ctx} />}
      <div className="dv-nav"><nav aria-label="Driver">
        {items.map(([id, label, Icon]) => <button key={id} type="button" className={tab === id ? "on" : ""} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}><Icon size={22} />{label}{id === "home" && offers > 0 && <span className="dot">{offers}</span>}</button>)}
      </nav></div>
    </div>
  );
}
