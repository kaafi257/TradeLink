import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, Dices, Gift, Percent, Ticket, Zap } from "lucide-react";
import { KIND_LABEL, STATUS_LABEL, couponOffer, couponStatus, etb, fromLocalInput, offerSub, offerText, rpc, toLocalInput, windowText, type Coupon, type CouponResult, type Promo, type PromoKind, type PromoResult, type PromoStatus } from "../../lib/promo";
import "./promo.css";

export const KIND_ICON = { sale: Percent, flash: Zap, bogo: Gift } as const;

export const StatusPill = ({ status }: { status: PromoStatus }) => <span className={`pm-pill ${status}`}>{STATUS_LABEL[status]}</span>;

/** Clean campaign card: the offer on a coloured band, the facts underneath, actions at the bottom. */
export function CampaignCard({ p, scopeText, owner, result, actions, banner }: { p: Promo; scopeText: string; owner?: string; result?: PromoResult; actions?: ReactNode; banner?: boolean }) {
  const Icon = KIND_ICON[p.kind];
  const live = p.status === "active" || p.status === "expired" || p.status === "paused";
  const count = p.promotion_items?.length;
  return (
    <article className={`pm-card k-${p.kind} s-${p.status}`}>
      <div className="pm-band">
        <span className="pm-ico"><Icon size={20} /></span>
        <div><b>{offerText(p)}</b>{offerSub(p) && <small>{offerSub(p)}</small>}</div>
        <StatusPill status={p.status} />
      </div>
      <div className="pm-body">
        <h3>{p.name}</h3>
        <p className="pm-meta">{KIND_LABEL[p.kind]} · {scopeText}{owner ? ` · ${owner}` : ""}{banner ? " · on homepage" : ""}</p>
        <p className="pm-when"><CalendarClock size={14} />{windowText(p)}</p>
        {live && count !== undefined && count > 0 && <p className="pm-meta">{count} product{count === 1 ? "" : "s"}</p>}
        {result && live && (
          <div className="pm-stats">
            <span><b>{Number(result.units)}</b><small>units</small></span>
            <span><b>{Number(result.orders)}</b><small>orders</small></span>
            <span><b>{etb(result.revenue)}</b><small>revenue</small></span>
            {p.kind === "bogo" && <span><b>{Number(result.free_units)}</b><small>free units</small></span>}
          </div>
        )}
        {p.review_note && <p className="pm-note">{p.status === "draft" ? "Changes requested: " : "Note: "}{p.review_note}</p>}
        {p.note && <p className="pm-note">{p.note}</p>}
      </div>
      {actions && <div className="pm-acts">{actions}</div>}
    </article>
  );
}

export function CouponCard({ c, used, result, owner, actions }: { c: Coupon; used?: number; result?: CouponResult; owner?: string; actions?: ReactNode }) {
  const status = couponStatus(c, used ?? 0);
  const rules = [c.min_order ? `min order ${etb(c.min_order)}` : "", c.max_discount ? `max ${etb(c.max_discount)} off` : "", c.max_uses ? `${used ?? 0}/${c.max_uses} used` : used ? `${used} used` : ""].filter(Boolean);
  return (
    <article className={`pm-card k-coupon s-${status}`}>
      <div className="pm-band">
        <span className="pm-ico"><Ticket size={20} /></span>
        <div><b>{couponOffer(c)}</b><small>{c.discount_type === "fixed" ? "off the order" : "off eligible items"}</small></div>
        <StatusPill status={status} />
      </div>
      <div className="pm-body">
        <h3><span className="pm-code">{c.code}</span></h3>
        <p className="pm-meta">{[c.name, owner].filter(Boolean).join(" · ") || "Coupon code"}</p>
        {rules.length > 0 && <p className="pm-meta">{rules.join(" · ")}</p>}
        <p className="pm-when"><CalendarClock size={14} />{windowText(c)}</p>
        {result && (Number(result.uses) > 0) && (
          <div className="pm-stats">
            <span><b>{Number(result.uses)}</b><small>requests</small></span>
            <span><b>{Number(result.orders)}</b><small>orders</small></span>
            <span><b>{etb(result.discount)}</b><small>given</small></span>
            <span><b>{etb(result.revenue)}</b><small>revenue</small></span>
          </div>
        )}
        {c.review_note && <p className="pm-note">{c.approval === "draft" ? "Changes requested: " : "Note: "}{c.review_note}</p>}
      </div>
      {actions && <div className="pm-acts">{actions}</div>}
    </article>
  );
}

export function Seg<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon?: ReactNode }[] }) {
  return <div className="pm-seg" role="radiogroup">{items.map(i => <button type="button" role="radio" aria-checked={value === i.id} key={i.id} className={value === i.id ? "on" : ""} onClick={() => onChange(i.id)}>{i.icon}{i.label}</button>)}</div>;
}

type Opt = { id: string; name: string };
type Btn = { primary: string; line: string };
const BTN: Record<"admin" | "supplier", Btn> = { admin: { primary: "btn green", line: "btn outline" }, supplier: { primary: "sp-btn primary", line: "sp-btn line" } };

/** The campaign form, shared by TradeLink staff and suppliers. A supplier can only cover its own store or one of its own products. */
export function CampaignForm({ role, initial, products, categories = [], suppliers = [], onDone, onCancel }: {
  role: "admin" | "supplier"; initial?: Promo | null; products: (Opt & { retail?: boolean })[]; categories?: Opt[]; suppliers?: Opt[]; onDone: (id: string) => void; onCancel: () => void;
}) {
  const admin = role === "admin";
  const [f, setF] = useState(() => ({
    name: initial?.name ?? "", kind: (initial?.kind ?? "sale") as PromoKind, scope: initial?.scope ?? (admin ? "category" : "store"),
    category_id: initial?.category_id ?? "", product_id: initial?.product_id ?? "", supplier_id: initial?.supplier_id ?? "",
    type: initial?.discount_type ?? "percent", percent: initial?.percent != null ? String(initial.percent) : "10", amount: initial?.amount != null ? String(initial.amount) : "",
    cap: initial?.max_discount != null ? String(initial.max_discount) : "", buy: String(initial?.buy_qty ?? 2), get: String(initial?.get_qty ?? 1),
    starts: toLocalInput(initial?.starts_at), ends: toLocalInput(initial?.ends_at), banner: initial?.show_banner ?? false, btext: initial?.banner_text ?? "",
  }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  useEffect(() => { if (f.kind === "flash" && !f.ends) { const d = new Date(Date.now() + 24 * 36e5); set("ends", toLocalInput(d.toISOString())); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [f.kind]);
  const pickable = products.filter(p => f.kind === "bogo" || p.retail !== false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const id = await rpc<string>("save_promotion", { p: {
        id: initial?.id ?? null, name: f.name, kind: f.kind, scope: f.scope, category_id: f.scope === "category" ? f.category_id : null, product_id: f.scope === "product" ? f.product_id : null,
        supplier_id: f.scope === "store" && admin ? f.supplier_id : null, discount_type: f.type, percent: f.kind !== "bogo" && f.type === "percent" ? f.percent : null,
        amount: f.kind !== "bogo" && f.type === "fixed" ? f.amount : null, max_discount: f.kind !== "bogo" ? f.cap || null : null,
        buy_qty: f.kind === "bogo" ? f.buy : null, get_qty: f.kind === "bogo" ? f.get : null, starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends),
        show_banner: admin && f.banner, banner_text: admin && f.banner ? f.btext : null,
      } });
      onDone(id);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const scopes: { id: Promo["scope"]; label: string }[] = admin
    ? [{ id: "category", label: "A category" }, { id: "product", label: "One product" }, { id: "store", label: "A supplier's store" }, { id: "all", label: "All retail products" }]
    : [{ id: "store", label: "My whole store" }, { id: "product", label: "One product" }];
  return (
    <form className="pm-form" onSubmit={e => void submit(e)}>
      <label>Name<input required minLength={2} maxLength={80} value={f.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Eid weekend" /></label>
      <div className="pm-field"><span>Type</span>
        <Seg value={f.kind} onChange={v => set("kind", v)} items={[{ id: "sale", label: "Sale", icon: <Percent size={15} /> }, { id: "flash", label: "Flash", icon: <Zap size={15} /> }, { id: "bogo", label: "Buy X Get Y", icon: <Gift size={15} /> }]} />
      </div>
      <label>Covers
        <select value={f.scope} onChange={e => set("scope", e.target.value as Promo["scope"])}>{scopes.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
      </label>
      {f.scope === "category" && <label>Category<select required value={f.category_id} onChange={e => set("category_id", e.target.value)}><option value="">Choose…</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      {f.scope === "product" && <label>Product<select required value={f.product_id} onChange={e => set("product_id", e.target.value)}><option value="">Choose…</option>{pickable.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        {!admin && f.kind !== "bogo" && <small>Sales need a retail price, so only products with one are listed.</small>}</label>}
      {f.scope === "store" && admin && <label>Supplier<select required value={f.supplier_id} onChange={e => set("supplier_id", e.target.value)}><option value="">Choose…</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      {f.kind === "bogo" ? (
        <div className="pm-two">
          <label>Customer buys<input type="number" min="1" max="20" step="1" required value={f.buy} onChange={e => set("buy", e.target.value)} /></label>
          <label>And gets free<input type="number" min="1" max="20" step="1" required value={f.get} onChange={e => set("get", e.target.value)} /></label>
        </div>
      ) : (
        <>
          <div className="pm-field"><span>Discount</span><Seg value={f.type} onChange={v => set("type", v)} items={[{ id: "percent", label: "Percentage" }, { id: "fixed", label: "Fixed amount" }]} /></div>
          <div className="pm-two">
            {f.type === "percent"
              ? <label>Percent off<input type="number" min="1" max="90" step="0.5" required value={f.percent} onChange={e => set("percent", e.target.value)} /></label>
              : <label>ETB off each unit<input type="number" min="0.01" step="0.01" required value={f.amount} onChange={e => set("amount", e.target.value)} /></label>}
            <label>Max discount per unit (ETB)<input type="number" min="0.01" step="0.01" value={f.cap} onChange={e => set("cap", e.target.value)} placeholder="No cap" /></label>
          </div>
        </>
      )}
      <div className="pm-two">
        <label>Starts<input type="datetime-local" value={f.starts} onChange={e => set("starts", e.target.value)} /></label>
        <label>Ends{f.kind === "flash" ? "" : " (optional)"}<input type="datetime-local" required={f.kind === "flash"} value={f.ends} onChange={e => set("ends", e.target.value)} /></label>
      </div>
      {admin && (
        <div className="pm-banner">
          <label className="pm-check"><input type="checkbox" checked={f.banner} onChange={e => set("banner", e.target.checked)} /> Feature on the homepage</label>
          {f.banner && <input maxLength={80} value={f.btext} onChange={e => set("btext", e.target.value)} placeholder="One short line under the offer (optional)" aria-label="Banner text" />}
        </div>
      )}
      <p className="pm-hint">{f.kind === "flash" ? "Flash sales run up to 72 hours. " : ""}{admin ? "Saved as a draft. Start it, or give it a start time and it begins by itself." : "Saved as a draft. Submit it for TradeLink approval when you are ready."} A product can be in only one promotion at a time.</p>
      {err && <p className="pm-err" role="alert">{err}</p>}
      <div className="pm-foot"><button type="button" className={BTN[role].line} onClick={onCancel}>Cancel</button><button className={BTN[role].primary} disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Save draft"}</button></div>
    </form>
  );
}

const makeCode = () => Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

export function CouponForm({ role, initial, onDone, onCancel }: { role: "admin" | "supplier"; initial?: Coupon | null; onDone: (id: string) => void; onCancel: () => void }) {
  const [f, setF] = useState(() => ({
    code: initial?.code ?? "", name: initial?.name ?? "", type: initial?.discount_type ?? "percent", percent: initial?.percent != null ? String(initial.percent) : "10",
    amount: initial?.amount != null ? String(initial.amount) : "", min: initial?.min_order != null ? String(initial.min_order) : "", cap: initial?.max_discount != null ? String(initial.max_discount) : "",
    uses: initial?.max_uses != null ? String(initial.max_uses) : "", starts: toLocalInput(initial?.starts_at), ends: toLocalInput(initial?.ends_at),
  }));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(s => ({ ...s, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const id = await rpc<string>("save_coupon", { p: {
        id: initial?.id ?? null, code: f.code, name: f.name, discount_type: f.type, percent: f.type === "percent" ? f.percent : null, amount: f.type === "fixed" ? f.amount : null,
        min_order: f.min || null, max_discount: f.type === "percent" ? f.cap || null : null, max_uses: f.uses || null, starts_at: fromLocalInput(f.starts), ends_at: fromLocalInput(f.ends),
      } });
      onDone(id);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="pm-form" onSubmit={e => void submit(e)}>
      <label>Code
        <span className="pm-code-in"><input required minLength={4} maxLength={20} pattern="[A-Za-z0-9_\-]{4,20}" title="4 to 20 letters, numbers, - or _" value={f.code} onChange={e => set("code", e.target.value.toUpperCase())} placeholder="WELCOME10" />
          <button type="button" className="pm-dice" aria-label="Generate a code" title="Generate a code" onClick={() => set("code", makeCode())}><Dices size={17} /></button></span>
      </label>
      <label>Note (optional)<input maxLength={80} value={f.name} onChange={e => set("name", e.target.value)} placeholder="Who or what it is for" /></label>
      <div className="pm-field"><span>Discount</span><Seg value={f.type} onChange={v => set("type", v)} items={[{ id: "percent", label: "Percentage" }, { id: "fixed", label: "Fixed amount" }]} /></div>
      <div className="pm-two">
        {f.type === "percent"
          ? <label>Percent off<input type="number" min="1" max="90" step="0.5" required value={f.percent} onChange={e => set("percent", e.target.value)} /></label>
          : <label>ETB off the order<input type="number" min="0.01" step="0.01" required value={f.amount} onChange={e => set("amount", e.target.value)} /></label>}
        {f.type === "percent" && <label>Max discount (ETB)<input type="number" min="0.01" step="0.01" value={f.cap} onChange={e => set("cap", e.target.value)} placeholder="No cap" /></label>}
      </div>
      <div className="pm-two">
        <label>Minimum order (ETB)<input type="number" min="0.01" step="0.01" value={f.min} onChange={e => set("min", e.target.value)} placeholder="None" /></label>
        <label>Usage limit<input type="number" min="1" step="1" value={f.uses} onChange={e => set("uses", e.target.value)} placeholder="Unlimited" /></label>
      </div>
      <div className="pm-two">
        <label>Valid from<input type="datetime-local" value={f.starts} onChange={e => set("starts", e.target.value)} /></label>
        <label>Valid until<input type="datetime-local" value={f.ends} onChange={e => set("ends", e.target.value)} /></label>
      </div>
      <p className="pm-hint">{role === "supplier" ? "A coupon from a supplier only takes money off that supplier's items, after TradeLink approves it. " : ""}Each phone number can use a code once. The discount is applied automatically when the request is priced, and never on items that already have a Buy X Get Y offer.</p>
      {err && <p className="pm-err" role="alert">{err}</p>}
      <div className="pm-foot"><button type="button" className={BTN[role].line} onClick={onCancel}>Cancel</button><button className={BTN[role].primary} disabled={busy}>{busy ? "Saving…" : initial ? "Save changes" : "Save draft"}</button></div>
    </form>
  );
}
