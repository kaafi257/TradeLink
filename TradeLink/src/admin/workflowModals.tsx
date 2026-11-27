import { useState, type FormEvent, type ReactNode } from "react";
import { BadgeCheck, MapPinned, Truck, X } from "lucide-react";
import { money } from "../lib/format";
import { errorText, requireSupabase, type OrderRow, type Quote } from "../lib/supabase";
import { useAdmin } from "./AdminData";
import { callRpc, useLoad } from "./suite";
import { byAvailability, type Candidate, type Candidates } from "./ops/cities";
import type { CityOption } from "../lib/checkout";

function Modal({ kicker, title, onClose, children }: { kicker: string; title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        <small className="kicker">{kicker}</small>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Run a database function, then report, refresh and close. Errors come back from the database in plain words. */
function useRun(onClose: () => void) {
  const { notify, reload } = useAdmin();
  const [busy, setBusy] = useState(false);
  const run = async (fn: string, args: Record<string, unknown>, done: string) => {
    setBusy(true);
    try {
      const { error } = await requireSupabase().rpc(fn, args);
      if (error) throw error;
      notify(done);
      onClose();
      await reload();
    } catch (e) { notify(errorText(e, "That did not work. Please try again.")); }
    finally { setBusy(false); }
  };
  return { busy, run };
}

export function PriceQuoteModal({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const items = quote.quotation_items ?? [];
  const [prices, setPrices] = useState<Record<string, string>>(() => Object.fromEntries(items.map(i => [i.id, Number(i.unit_price) > 0 ? String(i.unit_price) : ""])));
  const { busy, run } = useRun(onClose);
  // Coupons (percentage or fixed, minimum order, one store only) and Buy X Get Y free units are worked out by the database when the prices are saved.
  const subtotal = items.reduce((sum, i) => sum + Number(i.quantity) * (Number(prices[i.id]) || 0), 0);
  const free = items.reduce((sum, i) => sum + Number(i.free_qty ?? 0), 0);
  const hasDiscount = !!quote.coupon_code || free > 0;
  const ready = items.length > 0 && items.every(i => Number(prices[i.id]) > 0);
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run("price_quote", { p_quote: quote.id, p_prices: items.map(i => ({ item_id: i.id, unit_price: Number(prices[i.id]) })) }, "Quotation priced.");
  };
  return (
    <Modal kicker={quote.quote_number} title={`Price quote for ${quote.customer_name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        {items.map(i => (
          <label key={i.id} className="full">{i.quantity} {i.unit} · {i.product_name} — price per {i.unit} (ETB)
            <input type="number" min="0.01" step="0.01" required value={prices[i.id] ?? ""} onChange={e => setPrices({ ...prices, [i.id]: e.target.value })} />
          </label>
        ))}
        {quote.coupon_code && <p className="full">Coupon <b>{quote.coupon_code}</b> is applied automatically when you save.{quote.coupon_note ? ` Note: ${quote.coupon_note}` : ""}</p>}
        {free > 0 && <p className="full">Buy X Get Y: {free} free {free === 1 ? "unit is" : "units are"} included on this request and come off the total automatically.</p>}
        <p className="full"><b>{hasDiscount ? "Subtotal before discounts" : "Quote total"}: {money(subtotal)}</b>{hasDiscount && <><br /><small>The final total is worked out and shown when you save.</small></>}</p>
        <button className="btn green full" type="submit" disabled={busy || !ready}>{busy ? "Saving…" : "Save prices and mark as quoted"}</button>
      </form>
    </Modal>
  );
}

export function SaleModal({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  const { busy, run } = useRun(onClose);
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    void run("record_sale", { p_order: order.id, p_amount_paid: Number(f.get("paid")), p_method: String(f.get("method")) }, "Sale recorded and stock deducted.");
  };
  return (
    <Modal kicker={order.order_number} title={`Record sale for ${order.customer_name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <p className="full">Order total <b>{money(Number(order.total_amount))}</b>. Recording the sale deducts the ordered quantities from stock and cannot be undone.</p>
        <label>Amount paid now (ETB)<input name="paid" type="number" min="0" max={order.total_amount} step="0.01" required defaultValue={order.total_amount} /></label>
        <label>Payment method<select name="method" defaultValue="cash"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="mobile_money">Mobile money</option><option value="credit">Credit (pay later)</option></select></label>
        <button className="btn green full" type="submit" disabled={busy}>{busy ? "Recording…" : "Record sale"}</button>
      </form>
    </Modal>
  );
}

export function AssignModal({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  const { staff, notify } = useAdmin();
  const { busy, run } = useRun(onClose);
  const [who, setWho] = useState("");
  const [pick, setPick] = useState({ city: "", zone: "" });
  const [savingCity, setSavingCity] = useState(false);
  const cands = useLoad(() => callRpc<Candidates>("ops_assign_candidates", { p_order: order.id }), [order.id]);
  const cityList = useLoad(() => callRpc<CityOption[]>("public_cities").catch(() => [] as CityOption[]), []);
  // If the city update (migration 0042) has not been run yet, fall back to the plain staff list so assigning still works.
  const legacy = !!cands.error && !cands.data;
  const legacyDrivers = staff.filter(s => s.active && ["delivery", "manager", "owner"].includes(s.role));
  const rows = legacy
    ? legacyDrivers.map(d => ({ profileId: d.id, name: d.full_name || d.email, role: d.role, verified: false, online: false, lastSeen: null, openJobs: 0 } as Candidate))
    : [...(cands.data?.drivers ?? [])].sort(byAvailability);
  const zones = cityList.data?.find(c => c.id === pick.city)?.zones ?? [];
  const saveCity = async () => {
    setSavingCity(true);
    try { await callRpc("ops_set_order_city", { p_order: order.id, p_city: pick.city, p_zone: pick.zone || null }); notify("City saved."); cands.reload(); }
    catch (e) { notify(errorText(e, "Could not save the city.")); }
    finally { setSavingCity(false); }
  };
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const when = String(f.get("when") || "");
    void run("assign_delivery", { p_order: order.id, p_assignee: who, p_scheduled: when ? new Date(when).toISOString() : null, p_notes: String(f.get("notes") || "") }, "Delivery assigned.");
  };
  const needsCity = !!cands.data?.needsCity;
  return (
    <Modal kicker={order.order_number} title={`Assign delivery to ${order.delivery_location}`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        {cands.data?.citiesOn && cands.data.cityName && <p className="asg-note full"><MapPinned size={16} /> <span><b>{cands.data.cityName}</b>{cands.data.zoneName ? ` · ${cands.data.zoneName}` : ""}. Only drivers who serve this city are listed.</span></p>}
        {needsCity && (
          <div className="full">
            <p className="asg-note"><MapPinned size={16} /> <span>This order has no city yet. Choose it to see the drivers who can take it.</span></p>
            <div className="asg-pick" style={{ marginTop: 8 }}>
              <select aria-label="City" value={pick.city} onChange={e => setPick({ city: e.target.value, zone: "" })}><option value="" disabled>City…</option>{(cityList.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              {zones.length > 0 && <select aria-label="Area" value={pick.zone} onChange={e => setPick({ ...pick, zone: e.target.value })}><option value="" disabled>Area…</option>{zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}</select>}
            </div>
            <button type="button" className="btn green" style={{ marginTop: 8 }} disabled={savingCity || !pick.city || (zones.length > 0 && !pick.zone)} onClick={() => void saveCity()}>{savingCity ? "Saving…" : "Save city"}</button>
          </div>
        )}
        {!needsCity && (
          <div className="full" role="radiogroup" aria-label="Delivery staff">
            <div className="asg-list">
              {rows.map(d => (
                <button key={d.profileId} type="button" role="radio" aria-checked={who === d.profileId} className={`asg-row ${who === d.profileId ? "on" : ""}`} onClick={() => setWho(d.profileId)}>
                  <Truck size={18} aria-hidden="true" />
                  <span className="grow">
                    <b>{d.name}{d.verified && <BadgeCheck size={14} aria-label="Verified" style={{ marginLeft: 5, color: "#0b6bb0", verticalAlign: "-2px" }} />}</b>
                    <small>{d.role !== "delivery" ? "Office staff" : legacy ? "Driver" : <><i className={`drs-dot ${d.online ? "on" : ""}`} /> {d.online ? "Online" : "Offline"} · {d.openJobs} open job{d.openJobs === 1 ? "" : "s"}</>}</small>
                  </span>
                </button>
              ))}
            </div>
            {!rows.length && !cands.loading && <p className="form-error" role="alert">{cands.data?.citiesOn ? `No driver serves ${cands.data.cityName ?? "this city"} yet. Add the city to a driver in Deliveries, Drivers.` : "No active delivery staff yet. Invite one on the Staff page."}</p>}
          </div>
        )}
        <label>Scheduled for<input name="when" type="datetime-local" /></label>
        <label className="full">Notes<textarea name="notes" rows={2} maxLength={500} /></label>
        <button className="btn green full" type="submit" disabled={busy || needsCity || !who}>{busy ? "Assigning…" : "Assign delivery"}</button>
      </form>
    </Modal>
  );
}
