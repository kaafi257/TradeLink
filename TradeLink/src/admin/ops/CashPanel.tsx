import { useState } from "react";
import { Banknote, CheckCircle2, Clock } from "lucide-react";
import { callRpc, dateOf, ErrorNote, Form, Modal, useAction, useLoad } from "../suite";

type H = { id: string; driver: string; name: string; expected: number; declared: number; received: number | null; difference: number | null; status: "submitted" | "confirmed"; note: string | null; confirmNote: string | null; at: string; orders: string };
type Over = { canConfirm: boolean; holding: { driver: string; name: string; amount: number; orders: number }[]; handovers: H[] };
const etb = (n: number) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })} ETB`;

function Confirm({ h, onClose, onDone }: { h: H; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [got, setGot] = useState(String(h.declared));
  const [note, setNote] = useState("");
  const diff = Number(got) - h.expected;
  return (
    <Modal title={h.name} kicker="CONFIRM CASH RECEIVED" onClose={onClose}>
      <p className="ops-empty">Orders: {h.orders || "none"}. Expected {etb(h.expected)}; the driver says {etb(h.declared)}.{h.note ? ` Driver note: ${h.note}` : ""}</p>
      <Form busy={busy} submit="Confirm received" onSubmit={() => void run(() => callRpc("ops_confirm_handover", { p_handover: h.id, p_received: Number(got), p_note: note }), "Cash handover confirmed.").then(ok => { if (ok) onDone(); })}>
        <label>Cash you received (ETB)<input inputMode="decimal" required value={got} onChange={e => setGot(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
        {Number.isFinite(diff) && diff !== 0 && <p className="ops-empty warn">Difference of {diff > 0 ? "+" : ""}{diff} ETB. Write what happened.</p>}
        <label>Note{diff !== 0 ? " (required)" : " (optional)"}<input maxLength={300} value={note} onChange={e => setNote(e.target.value)} required={diff !== 0} /></label>
      </Form>
    </Modal>
  );
}

/** Cash-on-delivery money: who is holding it, handovers waiting for confirmation, and differences. */
export default function CashPanel() {
  const o = useLoad(() => callRpc<Over>("ops_cash_overview"), []);
  const [pick, setPick] = useState<H | null>(null);
  const waiting = o.data?.handovers.filter(h => h.status === "submitted") ?? [];
  return (
    <section className="cty" aria-label="Cash handover">
      <ErrorNote text={o.error} />
      {o.data && o.data.holding.length === 0 && waiting.length === 0 && <p className="ops-empty">No cash is waiting to be handed over.</p>}
      {o.data?.holding.map(x => (
        <article key={x.driver} className="cty-card"><header><b><Banknote size={15} /> {x.name}</b><small>{x.orders} order{x.orders === 1 ? "" : "s"} collected, not handed over</small><b>{etb(x.amount)}</b></header></article>
      ))}
      {waiting.map(h => (
        <article key={h.id} className="cty-card">
          <header><b><Clock size={15} /> {h.name}</b><small>{dateOf(h.at)} · {h.orders}</small><b>{etb(h.declared)}</b></header>
          {h.declared !== h.expected && <p className="ops-empty warn">Expected {etb(h.expected)}, driver says {etb(h.declared)}.</p>}
          {o.data?.canConfirm && <div className="prc-act"><button type="button" className="drs-btn" onClick={() => setPick(h)}><CheckCircle2 size={16} /> Confirm received</button></div>}
        </article>
      ))}
      {o.data?.handovers.filter(h => h.status === "confirmed").slice(0, 8).map(h => (
        <article key={h.id} className="cty-card off"><header><b><CheckCircle2 size={15} /> {h.name}</b><small>{dateOf(h.at)} · {h.orders}</small><b>{etb(h.received ?? 0)}</b></header>
          {!!h.difference && <p className="ops-empty warn">Difference {h.difference > 0 ? "+" : ""}{h.difference} ETB{h.confirmNote ? `: ${h.confirmNote}` : ""}</p>}</article>
      ))}
      {pick && <Confirm h={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); o.reload(); }} />}
    </section>
  );
}
