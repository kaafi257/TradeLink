import { useEffect, useRef, useState } from "react";
import { Bike, CheckCircle2, Camera, Headphones, History, LifeBuoy, Phone, Power, ShieldCheck, Truck, User } from "lucide-react";
import { callRpc, ErrorNote, useLoad } from "../suite";
import { useContact } from "../../lib/contact";
import { imageToDataUrl } from "../../lib/photo";
import DriverMap from "../ops/DriverMap";
import JobCard from "./JobCard";
import { ReportSheet } from "./Sheets";
import DriverMoney, { type EarnPlus } from "./DriverMoney";
import { etb, type Ctx, type Earn, type Hist, type Job, type Prof } from "./types";
import type { Due } from "../ops/CashModal";
import { CashModal } from "../ops/CashModal";

const when = (iso: string) => new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function useDue(c: Ctx) {
  const due = useLoad(() => callRpc<Due[]>("my_cod_due").catch(() => [] as Due[]), [c.mine?.jobs.length]);
  const [cash, setCash] = useState<Due | null>(null);
  const forJob = (ref: string) => {
    const d = due.data?.find(x => x.order_number === ref);
    return d ? <button type="button" className="dv-big blue" onClick={() => setCash(d)}>Collect {etb(d.amount)} cash</button> : null;
  };
  const modal = cash ? <CashModal due={cash} onClose={() => setCash(null)} onDone={() => { setCash(null); due.reload(); }} /> : null;
  return { forJob, modal };
}

/** Plays a short sound and vibrates when a new request arrives while the app is open. */
function useAlert(count: number) {
  const prev = useRef(count);
  useEffect(() => {
    if (count > prev.current) {
      try { navigator.vibrate?.([200, 100, 200]); const a = new AudioContext(), o = a.createOscillator(); o.frequency.value = 880; o.connect(a.destination); o.start(); setTimeout(() => { o.stop(); void a.close(); }, 250); } catch { /* sound is optional */ }
    }
    prev.current = count;
  }, [count]);
}

export function HomeTab({ c }: { c: Ctx }) {
  const jobs = c.mine?.jobs ?? [];
  const offers = jobs.filter(j => !j.accepted && j.status === "assigned");
  const active = jobs.filter(j => j.accepted || j.status === "in_transit");
  const earn = useLoad(() => callRpc<Earn>("driver_earnings"), [jobs.length]);
  const { forJob, modal } = useDue(c);
  useAlert(offers.length);
  return (
    <>
      <div className={`dv-card dv-online ${c.online ? "on" : ""}`}>
        <div><b>{c.online ? "You are online" : "You are offline"}</b><p className="dv-muted">{c.online ? "Sharing your location with the team." : "Go online to receive deliveries."}</p></div>
        <button type="button" className="dv-pwr" onClick={c.toggle} disabled={c.busy} aria-label={c.online ? "Go offline" : "Go online"}><Power size={28} /></button>
      </div>
      {c.gps && <div className="ops-banner" role="alert">{c.gps}</div>}
      {c.online && !c.here && !c.gps && <div className="ops-banner" role="status">Waiting for your GPS position. Keep location turned on while you work.</div>}
      <div className="dv-stats">
        <div className="dv-stat"><span>Deliveries today</span><b>{earn.data?.today.count ?? 0}</b></div>
        <div className="dv-stat"><span>Earned today</span><b>{etb(earn.data?.today.amount)}</b></div>
      </div>
      {offers.length > 0 && <h2>New requests ({offers.length})</h2>}
      {offers.map(j => <JobCard key={j.id} j={j} c={c} />)}
      {active.length > 0 && <><h2>In progress</h2>{c.online && <DriverMap here={c.here} jobs={active} />}</>}
      {active.map(j => <JobCard key={j.id} j={j} c={c} due={forJob(j.ref)} />)}
      {jobs.length === 0 && <div className="dv-card dv-empty"><Truck size={34} />{c.online ? "Waiting for the next delivery request." : "You are offline. Go online to get requests."}</div>}
      {modal}
    </>
  );
}

export function JobsTab({ c }: { c: Ctx }) {
  const [view, setView] = useState<"active" | "history">("active");
  const hist = useLoad(() => callRpc<Hist[]>("driver_history", { p_limit: 80 }), [c.mine?.jobs.length]);
  const { forJob, modal } = useDue(c);
  const jobs: Job[] = c.mine?.jobs ?? [];
  return (
    <>
      <div className="dv-seg" role="tablist"><button className={view === "active" ? "on" : ""} onClick={() => setView("active")}>Active ({jobs.length})</button><button className={view === "history" ? "on" : ""} onClick={() => setView("history")}>History</button></div>
      {view === "active" && (jobs.length ? jobs.map(j => <JobCard key={j.id} j={j} c={c} due={forJob(j.ref)} />) : <div className="dv-card dv-empty"><Truck size={34} />No active deliveries.</div>)}
      {view === "history" && <>
        <ErrorNote text={hist.error} />
        {hist.data?.length === 0 && <div className="dv-card dv-empty"><History size={34} />Completed and cancelled deliveries will appear here.</div>}
        {hist.data?.map(h => (
          <div className="dv-card" key={h.id}>
            <div className="dv-job-top"><span className="dv-ref">{h.ref}</span><span className={`dv-pill ${h.status === "delivered" ? "ok" : "bad"}`}>{h.status === "delivered" ? "Delivered" : h.rejected ? "Declined" : "Cancelled"}</span></div>
            <p className="dv-muted">{h.customer} · {h.address}</p>
            <div className="dv-job-top"><small className="dv-muted">{when(h.at)}</small>{h.status === "delivered" && <span className="dv-money">{h.fee != null ? etb(h.fee) : "Pay not set"}</span>}</div>
            {h.status === "failed" && h.note && <small className="dv-muted">{h.note}</small>}
          </div>))}
      </>}
      {modal}
    </>
  );
}

export function EarnTab() {
  const e = useLoad(() => callRpc<EarnPlus>("driver_earnings"), []);
  const d = e.data;
  const max = Math.max(1, ...(d?.days.map(x => x.amount) ?? [1]));
  const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Addis_Ababa" });
  return (
    <>
      <ErrorNote text={e.error} />
      <div className="dv-stats">
        <div className="dv-stat"><span>Today</span><b>{etb(d?.today.amount)}</b><span>{d?.today.count ?? 0} deliveries</span></div>
        <div className="dv-stat"><span>Last 7 days</span><b>{etb(d?.week.amount)}</b><span>{d?.week.count ?? 0} deliveries</span></div>
        <div className="dv-stat" style={{ gridColumn: "1 / -1" }}><span>This month</span><b>{etb(d?.month.amount)}</b><span>{d?.month.count ?? 0} deliveries</span></div>
      </div>
      {!!d?.unpriced && <p className="dv-muted">{d.unpriced} delivery{d.unpriced > 1 ? "ies have" : " has"} no pay set yet. It will count once the team sets it.</p>}
      <DriverMoney d={d ?? undefined} />
      <div className="dv-card">
        <h2>Last 14 days</h2>
        <div className="dv-bars">{d?.days.map(x => <div key={x.day} className={x.day.slice(0, 10) === todayKey ? "today" : ""} title={`${x.day.slice(0, 10)}: ${etb(x.amount)}`}><i style={{ height: `${Math.round((x.amount / max) * 100)}%` }} /><small>{x.day.slice(8, 10)}</small></div>)}</div>
      </div>
      <div className="dv-card"><h2>By day</h2>
        {d?.days.filter(x => x.count > 0).reverse().map(x => <div className="dv-job-top" key={x.day}><span>{new Date(x.day).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })} · {x.count} {x.count > 1 ? "deliveries" : "delivery"}</span><b className="dv-money">{etb(x.amount)}</b></div>)}
        {d && d.days.every(x => x.count === 0) && <p className="dv-muted">No completed deliveries yet.</p>}
      </div>
    </>
  );
}

export function ProfileTab({ c }: { c: Ctx }) {
  const p = useLoad(() => callRpc<Prof>("driver_profile"), []);
  const contact = useContact();
  const [f, setF] = useState({ phone: "", vehicle: "Motorbike", plate: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { if (p.data) setF({ phone: p.data.phone ?? "", vehicle: p.data.vehicle, plate: p.data.plate ?? "" }); }, [p.data]);
  const save = () => c.act(() => callRpc("driver_update_profile", { p_phone: f.phone, p_vehicle: f.vehicle, p_plate: f.plate, p_photo: photo }).then(() => { setPhoto(null); p.reload(); }), "Profile saved.");
  const shown = photo ?? p.data?.photo ?? null;
  const jobs = (c.mine?.jobs ?? []).map(j => ({ id: j.id, ref: j.ref }));
  return (
    <>
      <ErrorNote text={p.error} />
      <div className="dv-card" style={{ alignItems: "center", textAlign: "center" }}>
        <button type="button" className="dv-av" onClick={() => file.current?.click()} aria-label="Change photo">{shown ? <img src={shown} alt="" /> : <User size={36} />}</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async e => { const x = e.target.files?.[0]; if (x) try { setPhoto(await imageToDataUrl(x, 360, 0.8)); } catch { /* ignore */ } }} />
        <button type="button" className="dv-pill" onClick={() => file.current?.click()}><Camera size={13} /> {shown ? "Change photo" : "Add photo"}</button>
        <h2 style={{ fontSize: 20 }}>{p.data?.name ?? "Driver"}</h2>
        <span className={`dv-pill ${p.data?.verified ? "ok" : "warn"}`}>{p.data?.verified ? <><ShieldCheck size={14} /> Verified driver</> : "Verification pending"}</span>
        <p className="dv-muted">{p.data?.delivered ?? 0} deliveries completed · {p.data?.email}</p>
      </div>
      <div className="dv-card">
        <h2><Bike size={16} style={{ verticalAlign: -3 }} /> Your details</h2>
        <label className="dv-field">Phone<input type="tel" inputMode="tel" value={f.phone} maxLength={40} onChange={e => setF({ ...f, phone: e.target.value })} placeholder="+251…" /></label>
        <label className="dv-field">Vehicle<select value={f.vehicle} onChange={e => setF({ ...f, vehicle: e.target.value })}>{["Motorbike", "Bicycle", "Car", "Van", "Truck", "On foot"].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="dv-field">Plate number<input value={f.plate} maxLength={20} onChange={e => setF({ ...f, plate: e.target.value })} /></label>
        <button type="button" className="dv-big" disabled={c.busy} onClick={() => void save()}><CheckCircle2 size={18} /> Save</button>
      </div>
      <div className="dv-card">
        <h2><LifeBuoy size={16} style={{ verticalAlign: -3 }} /> Help and safety</h2>
        {contact.phone && <a className="dv-big soft" href={`tel:${contact.phone}`}><Phone size={18} /> Call support</a>}
        <button type="button" className="dv-big danger" onClick={() => setReport(true)}><Headphones size={18} /> Report a problem</button>
        <p className="dv-muted">In an emergency call your local emergency number first.</p>
      </div>
      {report && <ReportSheet jobs={jobs} busy={c.busy} onClose={() => setReport(false)} onSubmit={(d, k, n) => void c.act(() => callRpc("driver_report_issue", { p_delivery: d, p_kind: k, p_note: n }).then(() => setReport(false)), "Sent. The team has been notified.")} />}
    </>
  );
}
