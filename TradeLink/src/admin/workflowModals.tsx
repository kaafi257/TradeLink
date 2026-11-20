import { useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { money } from "../lib/format";
import { errorText, requireSupabase, type OrderRow, type Quote } from "../lib/supabase";
import { useAdmin } from "./AdminData";

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
  const off = Number(quote.discount_percent) || 0;   // coupon the customer entered; each line is discounted and rounded like the database does
  const total = items.reduce((sum, i) => sum + Math.round(Number(i.quantity) * Math.round((Number(prices[i.id]) || 0) * (1 - off / 100) * 100) / 100 * 100) / 100, 0);
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
        {off > 0 && <p className="full">Coupon <b>{quote.coupon_code}</b>: {off}% off every line.</p>}
        <p className="full"><b>Quote total: {money(total)}</b></p>
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
  const { staff } = useAdmin();
  const { busy, run } = useRun(onClose);
  const drivers = staff.filter(s => s.active && ["delivery", "manager", "owner"].includes(s.role));
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const when = String(f.get("when") || "");
    void run("assign_delivery", { p_order: order.id, p_assignee: String(f.get("who")), p_scheduled: when ? new Date(when).toISOString() : null, p_notes: String(f.get("notes") || "") }, "Delivery assigned.");
  };
  return (
    <Modal kicker={order.order_number} title={`Assign delivery to ${order.delivery_location}`} onClose={onClose}>
      <form className="form-grid" onSubmit={save}>
        <label>Delivery staff<select name="who" required defaultValue=""><option value="" disabled>Choose…</option>{drivers.map(d => <option key={d.id} value={d.id}>{d.full_name || d.email} ({d.role})</option>)}</select></label>
        <label>Scheduled for<input name="when" type="datetime-local" /></label>
        <label className="full">Notes<textarea name="notes" rows={2} maxLength={500} /></label>
        {!drivers.length && <p className="form-error full" role="alert">No active delivery staff yet. Invite one on the Staff page.</p>}
        <button className="btn green full" type="submit" disabled={busy || !drivers.length}>{busy ? "Assigning…" : "Assign delivery"}</button>
      </form>
    </Modal>
  );
}
