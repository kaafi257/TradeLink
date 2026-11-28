import { useState } from "react";
import { Coins, Trash2 } from "lucide-react";
import { callRpc, ErrorNote, useAction, useLoad } from "../suite";
import type { City } from "./cities";

type FeeRule = { id: string; cityId: string; zoneId: string | null; base: number; perKm: number; min: number | null; max: number | null; road: number; active: boolean };
type PayRule = { id: string; cityId: string; zoneId: string | null; base: number; perKm: number; road: number; active: boolean };
type Pricing = { canEdit: boolean; flat: { fee: number; freeOver: number | null }; fee: FeeRule[]; pay: PayRule[] };
const num = (v: string) => (v.trim() === "" ? null : Number(v));

function Row({ kind, cityId, zoneId, title, rule, canEdit, onDone }: { kind: "fee" | "pay"; cityId: string; zoneId: string | null; title: string; rule: FeeRule | PayRule | undefined; canEdit: boolean; onDone: () => void }) {
  const { busy, run } = useAction();
  const f = rule as FeeRule | undefined;
  const [v, setV] = useState({ base: String(rule?.base ?? ""), perKm: String(rule?.perKm ?? ""), min: String(f?.min ?? ""), max: String(f?.max ?? ""), road: String(rule?.road ?? "1") });
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV(x => ({ ...x, [k]: e.target.value }));
  const save = (active: boolean) => void run(() => (kind === "fee"
    ? callRpc("ops_save_fee_rule", { p_city: cityId, p_zone: zoneId, p_base: num(v.base) ?? 0, p_per_km: num(v.perKm) ?? 0, p_min: num(v.min), p_max: num(v.max), p_road: num(v.road) ?? 1, p_active: active })
    : callRpc("ops_save_pay_rule", { p_city: cityId, p_zone: zoneId, p_base: num(v.base) ?? 0, p_per_km: num(v.perKm) ?? 0, p_road: num(v.road) ?? 1, p_active: active })).then(onDone), "Saved.");
  const remove = () => void run(() => callRpc("ops_delete_rule", { p_kind: kind, p_id: rule!.id }).then(onDone), "Rate removed.");
  return (
    <div className={`prc-row ${rule && !rule.active ? "off" : ""}`}>
      <b>{title}</b>
      <div className="prc-fields">
        <label>{kind === "fee" ? "Base fee" : "Base pay"}<input inputMode="decimal" disabled={!canEdit} value={v.base} onChange={set("base")} placeholder="0" /></label>
        <label>Per km<input inputMode="decimal" disabled={!canEdit} value={v.perKm} onChange={set("perKm")} placeholder="0" /></label>
        {kind === "fee" && <><label>Lowest fee<input inputMode="decimal" disabled={!canEdit} value={v.min} onChange={set("min")} placeholder="none" /></label>
          <label>Highest fee<input inputMode="decimal" disabled={!canEdit} value={v.max} onChange={set("max")} placeholder="none" /></label></>}
        <label>Road factor<input inputMode="decimal" disabled={!canEdit} value={v.road} onChange={set("road")} title="1 = straight line; 1.3 = add 30% for winding roads" /></label>
      </div>
      {canEdit && (
        <div className="prc-act">
          <button type="button" className="drs-btn" disabled={busy || v.base.trim() === ""} onClick={() => save(true)}>{rule ? "Save" : "Set rate"}</button>
          {rule && <button type="button" className={`ops-pill ${rule.active ? "on" : ""}`} aria-pressed={rule.active} disabled={busy} onClick={() => save(!rule.active)}>{rule.active ? "On" : "Off"}</button>}
          {rule && <button type="button" className="ops-pill" disabled={busy} onClick={remove} aria-label={`Remove ${title}`}><Trash2 size={14} /></button>}
        </div>
      )}
      {!rule && !canEdit && <small>Not set</small>}
    </div>
  );
}

/** Customer delivery fee (base + per km) and driver pay per city and area. Only the owner can change rates; nothing is set until the owner enters it. */
export default function PricingPanel({ cities }: { cities: City[] }) {
  const p = useLoad(() => callRpc<Pricing>("ops_pricing"), []);
  const [kind, setKind] = useState<"fee" | "pay">("fee");
  const d = p.data;
  const find = (c: string, z: string | null) => (kind === "fee" ? d?.fee : d?.pay)?.find(r => r.cityId === c && r.zoneId === z);
  return (
    <section className="cty" aria-label="Delivery prices">
      <ErrorNote text={p.error} />
      <div className="prc-head">
        <span className="dv-seg" role="group" aria-label="Which rates">
          <button type="button" className={kind === "fee" ? "on" : ""} aria-pressed={kind === "fee"} onClick={() => setKind("fee")}>Customer delivery fee</button>
          <button type="button" className={kind === "pay" ? "on" : ""} aria-pressed={kind === "pay"} onClick={() => setKind("pay")}>Driver pay</button>
        </span>
      </div>
      {d && kind === "fee" && <p className="ops-empty"><Coins size={15} /> Cities without a rate keep today's flat fee of {d.flat.fee} ETB{d.flat.freeOver !== null ? `, free over ${d.flat.freeOver} ETB` : ""}. Distance is measured in a straight line from the shop to the customer, times the road factor.</p>}
      {d && kind === "pay" && <p className="ops-empty">Pay is added when a delivery is completed, only if no pay was typed on that delivery. Without a rate, the job stays "pay not set".</p>}
      {d && !d.canEdit && <p className="ops-empty">Only the owner can change these rates.</p>}
      {cities.length === 0 && <p className="ops-empty">Add a city first (Cities and areas).</p>}
      {cities.map(c => (
        <article key={c.id} className="cty-card">
          <header><b>{c.name}</b></header>
          <Row key={`${kind}-${c.id}-${find(c.id, null)?.id ?? "x"}`} kind={kind} cityId={c.id} zoneId={null} title="Whole city" rule={find(c.id, null)} canEdit={!!d?.canEdit} onDone={p.reload} />
          {c.zones.map(z => <Row key={`${kind}-${z.id}-${find(c.id, z.id)?.id ?? "x"}`} kind={kind} cityId={c.id} zoneId={z.id} title={`Area: ${z.name}`} rule={find(c.id, z.id)} canEdit={!!d?.canEdit} onDone={p.reload} />)}
        </article>
      ))}
    </section>
  );
}
