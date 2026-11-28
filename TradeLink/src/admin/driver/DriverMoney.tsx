import { useState } from "react";
import { Banknote, CalendarDays, CheckCircle2, Clock, HandCoins, Wallet } from "lucide-react";
import { callRpc, ErrorNote, useAction, useLoad } from "../suite";
import { Sheet } from "./Sheets";
import { etb, type Earn } from "./types";

type Period = { start: string; amount: number; count: number };
type Payout = { id: string; amount: number; method: string; reference: string | null; paidOn: string };
type Cash = { holding: number; orders: { order: string; amount: number; at: string | null }[]; recent: { id: string; expected: number; declared: number; received: number | null; difference: number | null; status: "submitted" | "confirmed"; at: string }[] };
export type EarnPlus = Earn & { earned?: number; paid?: number; owed?: number; weeks?: Period[]; months?: Period[] };

const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
const how = (m: string) => m.replace(/_/g, " ");

/** What the driver has earned, been paid and is still owed; weekly/monthly totals; and the cash they must hand over. Real data only. */
export default function DriverMoney({ d }: { d: EarnPlus | undefined }) {
  const payouts = useLoad(() => callRpc<Payout[]>("driver_payouts").catch(() => null), []);
  const cash = useLoad(() => callRpc<Cash>("driver_cash").catch(() => null), []);
  const [per, setPer] = useState<"weeks" | "months">("weeks");
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const { busy, run } = useAction();
  const rows = (per === "weeks" ? d?.weeks : d?.months) ?? [];
  const held = cash.data?.holding ?? 0;
  const submit = async () => {
    setErr("");
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) { setErr("Enter the cash you are handing over."); return; }
    const ok = await run(() => callRpc("driver_submit_handover", { p_declared: n, p_note: note.trim() || null }), "Sent. The office will confirm when they receive it.");
    if (ok) { setOpen(false); setAmount(""); setNote(""); cash.reload(); }
  };
  return (
    <>
      {d?.owed !== undefined && (
        <div className="dv-card">
          <h2><Wallet size={16} style={{ verticalAlign: -3 }} /> Your pay</h2>
          <div className="dv-owed">
            <div><span>Earned</span><b>{etb(d.earned)}</b></div>
            <div><span>Paid to you</span><b>{etb(d.paid)}</b></div>
            <div className="owe"><span>Still owed</span><b>{etb(d.owed)}</b></div>
          </div>
          {payouts.data?.slice(0, 5).map(p => (
            <div className="dv-job-top" key={p.id}><span><CheckCircle2 size={14} style={{ verticalAlign: -2 }} /> {day(p.paidOn)} · {how(p.method)}{p.reference ? ` · ${p.reference}` : ""}</span><b>{etb(p.amount)}</b></div>
          ))}
          {payouts.data?.length === 0 && <p className="dv-muted">No payment recorded yet. The office records each payment here once it is paid.</p>}
        </div>
      )}
      {(d?.weeks || d?.months) && (
        <div className="dv-card">
          <div className="dv-job-top"><h2><CalendarDays size={16} style={{ verticalAlign: -3 }} /> {per === "weeks" ? "Weekly" : "Monthly"} totals</h2>
            <span className="dv-seg" role="group" aria-label="Period">
              <button type="button" className={per === "weeks" ? "on" : ""} aria-pressed={per === "weeks"} onClick={() => setPer("weeks")}>Weeks</button>
              <button type="button" className={per === "months" ? "on" : ""} aria-pressed={per === "months"} onClick={() => setPer("months")}>Months</button>
            </span>
          </div>
          {rows.map(r => <div className="dv-job-top" key={r.start}><span>{per === "weeks" ? `Week of ${day(r.start)}` : new Date(r.start).toLocaleDateString([], { month: "long", year: "numeric" })} · {r.count} {r.count === 1 ? "delivery" : "deliveries"}</span><b>{etb(r.amount)}</b></div>)}
          {rows.length === 0 && <p className="dv-muted">No completed deliveries in this period yet.</p>}
        </div>
      )}
      {cash.data && (held > 0 || cash.data.recent.length > 0) && (
        <div className="dv-card">
          <h2><Banknote size={16} style={{ verticalAlign: -3 }} /> Cash to hand over</h2>
          <div className="dv-owed"><div className="owe"><span>You are holding</span><b>{etb(held)}</b></div></div>
          {cash.data.orders.map(o => <div className="dv-job-top" key={o.order}><span>{o.order}</span><b>{etb(o.amount)}</b></div>)}
          {held > 0 && <button type="button" className="dv-big" onClick={() => { setAmount(String(held)); setOpen(true); }}><HandCoins size={18} /> Hand over cash</button>}
          {cash.data.recent.slice(0, 3).map(h => (
            <div className="dv-job-top" key={h.id}>
              <span>{day(h.at)} · {etb(h.declared)}</span>
              <span className={`dv-pill ${h.status === "confirmed" ? (h.difference ? "warn" : "ok") : ""}`}>{h.status === "confirmed" ? <><CheckCircle2 size={13} /> {h.difference ? `Difference ${h.difference > 0 ? "+" : ""}${h.difference}` : "Confirmed"}</> : <><Clock size={13} /> Waiting for office</>}</span>
            </div>
          ))}
        </div>
      )}
      <ErrorNote text={payouts.error || cash.error} />
      {open && (
        <Sheet title="Hand over cash" onClose={() => setOpen(false)}>
          <p className="dv-muted">You collected {etb(held)}. Enter exactly the cash you are giving to the office.</p>
          <label className="dv-field">Cash handed over (ETB)<input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="dv-field">Note (only if it is different)<textarea value={note} maxLength={300} onChange={e => setNote(e.target.value)} /></label>
          {err && <p className="dv-err" role="alert">{err}</p>}
          <button type="button" className="dv-big" disabled={busy || amount === ""} onClick={() => void submit()}>{busy ? "Sending…" : "Send to the office"}</button>
        </Sheet>
      )}
    </>
  );
}
