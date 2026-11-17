import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, Briefcase, Check, Phone, Plus, Trash2, User, X } from "lucide-react";
import { ContactPills } from "../components/ContactActions";
import { TURNSTILE_SITE_KEY, Turnstile } from "../components/Turnstile";
import { money } from "../lib/format";
import { supabase, type PublicProduct } from "../lib/supabase";
import "./home.css";

export type Mode = "business" | "individual";
export type Line = { key: string; productId: string; qty: string };

export const MODE_KEY = "tradelink-mode";
export const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === "individual" ? "individual" : "business"; } catch { return "business"; } };
const audienceOf = (p: PublicProduct) => p.audience ?? "both";
export const allows = (p: PublicProduct, m: Mode) => audienceOf(p) === "both" || audienceOf(p) === (m === "individual" ? "b2c" : "b2b");
export const defaultQty = (p: PublicProduct | undefined, m: Mode) => (m === "individual" ? "1" : String(Number(p?.min_order_quantity ?? 1)));
export const catKey = (p: PublicProduct) => p.category_id ?? `name:${p.category}`;
const productLabel = (p: PublicProduct) => (p.package_size ? `${p.name} — ${p.package_size}` : p.name);
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

/** Also used by the fashion storefront. `extraNotes` adds a line per product (e.g. size and colour); `lockType` hides the wholesale switch. */
export function RequestModal({ products, mode, onMode, initial, onLines, onClose, onSent, extraNotes, lockType }: {
  extraNotes?: Record<string, string>; lockType?: boolean;
  products: PublicProduct[]; mode: Mode; onMode: (m: Mode) => void; initial: Line[]; onLines: (l: Line[]) => void; onClose: () => void; onSent: () => void;
}) {
  const [type, setType] = useState<Mode>(mode);
  const [lines, setLines] = useState<Line[]>(initial.length ? initial : [{ key: newKey(), productId: "", qty: defaultQty(undefined, mode) }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [token, setToken] = useState("");
  const onToken = useCallback((t: string) => setToken(t), []);

  // Keep the request list in sync, so products added here are still there if the window is closed.
  useEffect(() => { onLines(lines.filter(l => l.productId)); }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const eligible = useMemo(() => products.filter(p => allows(p, type)), [products, type]);
  const groups = useMemo(() => {
    const m = new Map<string, PublicProduct[]>();
    for (const p of eligible) m.set(p.category, [...(m.get(p.category) ?? []), p]);
    return [...m.entries()];
  }, [eligible]);
  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const switchType = (t: Mode) => {
    setType(t); onMode(t);
    setLines(ls => ls.map(l => { const p = byId.get(l.productId); return p && !allows(p, t) ? { ...l, productId: "", qty: defaultQty(undefined, t) } : l; }));
  };
  const setLine = (key: string, patch: Partial<Line>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const pickProduct = (key: string, id: string) => setLine(key, { productId: id, qty: defaultQty(byId.get(id), type) });
  const chosen = lines.filter(l => l.productId);
  const estimate = type === "individual" ? chosen.reduce((s, l) => s + Number(l.qty || 0) * Number(byId.get(l.productId)?.retail_price ?? 0), 0) : 0;
  const estimateComplete = type === "individual" && chosen.length > 0 && chosen.every(l => Number(byId.get(l.productId)?.retail_price ?? 0) > 0);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!chosen.length) { setError("Please choose at least one product."); return; }
    if (new Set(chosen.map(l => l.productId)).size !== chosen.length) { setError("A product is listed twice. Please combine the quantities."); return; }
    if (!supabase) { setError("This website is not connected to its database yet. Please contact us by phone."); return; }
    const f = new FormData(e.currentTarget);
    const items = chosen.map(l => ({ product_id: l.productId, quantity: Number(l.qty) }));
    const fields = {
      name: String(f.get("name") ?? ""), phone: String(f.get("phone") ?? ""), email: String(f.get("email") ?? ""),
      location: String(f.get("location") ?? ""), notes: String(f.get("notes") ?? ""), website: String(f.get("website") ?? ""),
    };
    const extra = chosen.filter(l => extraNotes?.[l.productId]).map(l => `${products.find(p => p.id === l.productId)?.name}: ${extraNotes![l.productId]}`).join("\n");
    if (extra) fields.notes = [fields.notes.trim(), extra].filter(Boolean).join("\n");
    if (TURNSTILE_SITE_KEY && !token) { setError("Please complete the security check."); return; }
    setBusy(true); setError("");
    let data: unknown; let failure = "";
    if (TURNSTILE_SITE_KEY) {
      const res = await supabase.functions.invoke("submit-quote", { body: { ...fields, items, customer_type: type === "individual" ? "individual" : "business", token } });
      if (res.error) {
        let msg = res.error.message;
        try { const body = await (res.error as { context?: Response }).context?.json(); if (body?.error) msg = body.error; } catch { /* keep generic message */ }
        failure = msg;
      } else if (res.data?.error) failure = String(res.data.error);
      else data = res.data?.quote_number;
    } else {
      const { data: d, error: rpcError } = await supabase.rpc("submit_request", {
        p_name: fields.name, p_phone: fields.phone, p_email: fields.email, p_location: fields.location, p_items: items,
        p_notes: fields.notes, p_website: fields.website, p_customer_type: type === "individual" ? "individual" : "business",
      });
      if (rpcError) failure = rpcError.message; else data = d;
    }
    setBusy(false);
    if (failure) { setError(failure); return; }
    setQuoteNumber(String(data ?? ""));
    onSent();
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal quote-modal" role="dialog" aria-modal="true" aria-label="Request a price">
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        {quoteNumber ? (
          <div className="success-state">
            <Check size={48} /><h2>Request received</h2>
            <p>Thank you. Your reference is <b>{quoteNumber}</b>. The TradeLink team will contact you shortly.</p>
            <ContactPills title="Want a faster reply? Message us with your reference" message={`Hello TradeLink, my request reference is ${quoteNumber}.`} />
            <button className="btn green" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <small className="kicker">Price request</small>
            <h2>Tell us what you need</h2>
            {!lockType && <div className="seg" role="group" aria-label="I am buying as">
              <button type="button" className={type === "business" ? "on" : ""} onClick={() => switchType("business")}><Briefcase size={15} /> Business (wholesale)</button>
              <button type="button" className={type === "individual" ? "on" : ""} onClick={() => switchType("individual")}><User size={15} /> Individual (retail)</button>
            </div>}
            <form className="form-grid" onSubmit={submit}>
              <div className="full req-lines">
                {lines.map(l => {
                  const p = byId.get(l.productId);
                  return (
                    <div className="req-line" key={l.key}>
                      <label>Product
                        <select value={l.productId} required onChange={e => pickProduct(l.key, e.target.value)}>
                          <option value="">Select product</option>
                          {groups.map(([cat, ps]) => <optgroup key={cat} label={cat}>{ps.map(x => <option key={x.id} value={x.id}>{productLabel(x)}</option>)}</optgroup>)}
                        </select>
                      </label>
                      <label>Quantity{p ? ` (${p.unit})` : ""}
                        <input type="number" required step="any" min={type === "individual" ? 1 : Number(p?.min_order_quantity ?? 1)} value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} placeholder={p && type === "business" ? `Min ${Number(p.min_order_quantity)}` : "1"} />
                      </label>
                      {lines.length > 1 && <button type="button" className="req-remove" aria-label="Remove this product" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}><Trash2 size={16} /></button>}
                    </div>
                  );
                })}
                {lines.length < 20 && <button type="button" className="btn outline req-add" onClick={() => setLines(ls => [...ls, { key: newKey(), productId: "", qty: defaultQty(undefined, type) }])}><Plus size={15} /> Add another product</button>}
                {type === "individual" && estimate > 0 && <p className="req-estimate">Estimated total: <b>{money(estimate)}</b>{estimateComplete ? "" : " (some items need a price from us)"}. We confirm the final price.</p>}
              </div>
              <label>{type === "individual" ? "Your name" : "Business / contact name"}<input name="name" required maxLength={120} placeholder={type === "individual" ? "Your name" : "Your name or business"} /></label>
              <label>Phone / WhatsApp<input name="phone" required maxLength={30} placeholder="+251 ..." /></label>
              <label>Email (optional)<input name="email" type="email" maxLength={160} placeholder="name@email.com" /></label>
              <label>Delivery location<input name="location" required maxLength={120} placeholder="City / town" /></label>
              <label className="full">Additional details<textarea name="notes" rows={2} maxLength={1000} placeholder="Timing or other requirements" /></label>
              <div className="honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              {TURNSTILE_SITE_KEY && <Turnstile onToken={onToken} />}
              {error && <p className="form-error full" role="alert">{error}</p>}
              {products.length === 0 && <p className="form-error full" role="alert">No products are available right now. Please check back soon.</p>}
              <button className="btn green full" type="submit" disabled={busy || products.length === 0}>{busy ? "Sending…" : "Send request"} <ArrowRight /></button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
