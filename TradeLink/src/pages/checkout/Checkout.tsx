import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Banknote, Landmark, Loader2, Minus, Package, Plus, Smartphone, Trash2, ShoppingBag } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { supabase, withPhoto, type PublicProduct } from "../../lib/supabase";
import { checkoutKey, clearCheckoutCart, fetchCheckoutOptions, loadCheckoutCart, saveIdentity, placeOrder, resetCheckoutKey, saveCheckoutCart, shareOrderLocation, type CheckoutItem, type CheckoutOptions, type PayMethod } from "../../lib/checkout";
import ShareLocation from "../../components/ShareLocation";
import type { Fix } from "../../lib/gps";
import { CoShell, etb } from "./parts";

const unitPrice = (p: PublicProduct) => {
  const r = Number(p.retail_price ?? 0), s = Number(p.sale_price ?? 0);
  return s > 0 && r > 0 && s < r ? s : r;
};

export default function Checkout() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [items, setItems] = useState<CheckoutItem[]>(() => loadCheckoutCart());
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [opts, setOpts] = useState<CheckoutOptions | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [method, setMethod] = useState<PayMethod | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [where, setWhere] = useState<Fix | null>(null);
  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; phone?: string };

  useEffect(() => {
    if (!supabase) { setState("error"); return; }
    let live = true;
    (async () => {
      try {
        const ids = items.map(i => i.product_id);
        const [o, p] = await Promise.all([
          fetchCheckoutOptions(),
          ids.length ? supabase!.from("public_products").select("*").in("id", ids) : Promise.resolve({ data: [], error: null }),
        ]);
        if (!live) return;
        if (p.error) throw p.error;
        setOpts(o);
        setProducts(((p.data ?? []) as PublicProduct[]).map(withPhoto));
        setMethod(m => m || (o.bank ? "bank_transfer" : o.telebirr ? "telebirr" : o.ebirr ? "ebirr" : o.cod ? "cod" : ""));
        setState("ready");
      } catch { if (live) setState("error"); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { saveCheckoutCart(items); }, [items]);

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const lines = items.map(i => ({ ...i, p: byId.get(i.product_id) })).filter((l): l is typeof l & { p: PublicProduct } => !!l.p);
  const missing = items.length - lines.length;
  const sub = lines.reduce((s, l) => s + unitPrice(l.p) * l.quantity, 0);
  const fee = !opts ? 0 : opts.free_delivery_over !== null && sub >= opts.free_delivery_over ? 0 : opts.delivery_fee;
  const saved = lines.reduce((s, l) => { const r = Number(l.p.retail_price ?? 0); return s + Math.max(0, r - unitPrice(l.p)) * l.quantity; }, 0);
  const setQty = (id: string, q: number) => setItems(it => it.map(i => (i.product_id === id ? { ...i, quantity: Math.max(1, Math.min(99, q)) } : i)));
  const remove = (id: string) => setItems(it => it.filter(i => i.product_id !== id));
  const none = !opts || (!opts.bank && !opts.cod && !opts.telebirr && !opts.ebirr);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (!method) { setError("Choose how you want to pay."); return; }
    if (!lines.length) { setError("Your cart is empty."); return; }
    if (!where) { setError("Please turn on GPS and press \"Share my delivery location\" so the driver can find you."); return; }
    const f = new FormData(e.currentTarget);
    const phone = String(f.get("phone") ?? "");
    setBusy(true); setError("");
    try {
      const r = await placeOrder({
        items: lines.map(l => ({ product_id: l.product_id, quantity: l.quantity })), name: String(f.get("name") ?? ""), phone, email: String(f.get("email") ?? ""),
        location: String(f.get("location") ?? ""), notes: String(f.get("notes") ?? ""), method, key: checkoutKey(), website: String(f.get("website") ?? ""),
      });
      // Best effort: the order is already placed, so a failed location save must not block the customer.
      try { await shareOrderLocation(r.order_number, phone, where); } catch { /* the team can still pin the drop-off by hand */ }
      clearCheckoutCart(); resetCheckoutKey(); saveIdentity({ name: String(f.get("name") ?? "").trim(), phone });
      try { sessionStorage.setItem(`tl-order-phone-${r.order_number}`, phone); } catch { /* storage unavailable */ }
      navigate(`/order/${r.order_number}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not place your order. Please try again.");
      setBusy(false);
    }
  };

  if (state === "loading") return <CoShell><p className="co-note"><Loader2 className="co-spin" /> Loading your order…</p></CoShell>;
  if (state === "error") return <CoShell back={{ to: "/", label: "Back to shop" }}><div className="co-empty"><ShoppingBag /><h1>Checkout is not available</h1><p>We could not reach the shop. Please try again in a moment.</p></div></CoShell>;
  if (!items.length || !lines.length) return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-empty"><ShoppingBag /><h1>Your cart is empty</h1><p>{missing ? "The products in your cart are no longer available." : "Add products from the shop, then come back to pay."}</p><Link className="btn green" to="/">Continue shopping</Link></div>
    </CoShell>
  );
  if (none) return (
    <CoShell back={{ to: "/", label: "Back to shop" }}>
      <div className="co-empty"><Landmark /><h1>Online payment is not open yet</h1><p>Paying online is not switched on at the moment. Send a price request instead and the TradeLink team will contact you.</p><Link className="btn green" to="/">Back to shop</Link></div>
    </CoShell>
  );

  return (
    <CoShell back={{ to: "/", label: "Keep shopping" }}>
      <h1 className="co-h1">Checkout</h1>
      <form className="co-grid" onSubmit={submit}>
        <div className="co-col">
          <section className="co-card" aria-labelledby="co-sum">
            <h2 id="co-sum"><span>1</span> Your order</h2>
            {lines.map(l => (
              <div className="co-line" key={l.product_id}>
                <span className="co-th">{l.p.image_url ? <img src={l.p.image_url} alt="" /> : <Package />}</span>
                <div className="co-nm"><b>{l.p.name}</b><small>{etb(unitPrice(l.p))} / {l.p.unit}</small></div>
                <div className="co-qty" role="group" aria-label={`Quantity of ${l.p.name}`}>
                  <button type="button" aria-label="Less" disabled={l.quantity <= 1} onClick={() => setQty(l.product_id, l.quantity - 1)}><Minus size={15} /></button>
                  <output>{l.quantity}</output>
                  <button type="button" aria-label="More" onClick={() => setQty(l.product_id, l.quantity + 1)}><Plus size={15} /></button>
                </div>
                <b className="co-sub">{etb(unitPrice(l.p) * l.quantity)}</b>
                <button type="button" className="co-x" aria-label={`Remove ${l.p.name}`} onClick={() => remove(l.product_id)}><Trash2 size={16} /></button>
              </div>
            ))}
            {missing > 0 && <p className="co-note warn">{missing} {missing === 1 ? "product is" : "products are"} no longer available and {missing === 1 ? "was" : "were"} removed from this order.</p>}
          </section>

          <section className="co-card" aria-labelledby="co-who">
            <h2 id="co-who"><span>2</span> Contact and delivery</h2>
            <div className="co-fields">
              <label>Full name<input name="name" required minLength={2} maxLength={120} autoComplete="name" defaultValue={meta.full_name ?? ""} /></label>
              <label>Phone<input name="phone" required type="tel" inputMode="tel" maxLength={20} autoComplete="tel" placeholder="+251 …" defaultValue={meta.phone ?? ""} /></label>
              <label className="wide">Email <small>(optional)</small><input name="email" type="email" maxLength={160} autoComplete="email" defaultValue={session?.user.email ?? ""} /></label>
              <label className="wide">Delivery address<input name="location" required minLength={2} maxLength={160} autoComplete="street-address" placeholder="Area, street, landmark" /></label>
              <div className="wide"><ShareLocation fix={where} onFix={setWhere} label="Share my delivery location" doneLabel="Delivery location saved" />
                <small className="co-note">Turn on GPS and stand where you want to receive the order. Only the delivery team sees it.</small></div>
              <label className="wide">Delivery instructions <small>(optional)</small><textarea name="notes" rows={2} maxLength={500} placeholder="Gate, floor, a call before arrival…" /></label>
              <div className="honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
            </div>
          </section>

          <section className="co-card" aria-labelledby="co-pay">
            <h2 id="co-pay"><span>3</span> Payment method</h2>
            <div className="co-methods" role="radiogroup" aria-label="Payment method">
              {opts?.bank && (
                <label className={`co-method${method === "bank_transfer" ? " on" : ""}`}>
                  <input type="radio" name="method" checked={method === "bank_transfer"} onChange={() => setMethod("bank_transfer")} />
                  <Landmark /><div><b>Bank transfer</b><small>Commercial Bank of Ethiopia. We confirm it once the money arrives.</small></div>
                </label>)}
              {opts?.telebirr && (
                <label className={`co-method${method === "telebirr" ? " on" : ""}`}>
                  <input type="radio" name="method" checked={method === "telebirr"} onChange={() => setMethod("telebirr")} />
                  <Smartphone /><div><b>Telebirr</b><small>Send to our Telebirr number, then upload the receipt screenshot. We confirm it once the money arrives.</small></div>
                </label>)}
              {opts?.ebirr && (
                <label className={`co-method${method === "ebirr" ? " on" : ""}`}>
                  <input type="radio" name="method" checked={method === "ebirr"} onChange={() => setMethod("ebirr")} />
                  <Smartphone /><div><b>eBirr</b><small>Send to our eBirr number, then upload the receipt screenshot. We confirm it once the money arrives.</small></div>
                </label>)}
              {opts?.cod && (
                <label className={`co-method${method === "cod" ? " on" : ""}`}>
                  <input type="radio" name="method" checked={method === "cod"} onChange={() => setMethod("cod")} />
                  <Banknote /><div><b>Cash on Delivery</b><small>Pay the delivery person in cash when your order arrives.</small></div>
                </label>)}
            </div>
          </section>
        </div>

        <aside className="co-col co-aside">
          <section className="co-card co-total" aria-label="Order total">
            <h2>Total</h2>
            <dl>
              <div><dt>Items</dt><dd>{etb(sub + saved)}</dd></div>
              {saved > 0 && <div className="save"><dt>Discount</dt><dd>− {etb(saved)}</dd></div>}
              <div><dt>Delivery</dt><dd>{fee > 0 ? etb(fee) : "Free"}</dd></div>
              <div className="sum"><dt>Total</dt><dd>{etb(sub + fee)}</dd></div>
            </dl>
            <p className="co-note">The final total is confirmed by TradeLink when you place the order.</p>
            {error && <p className="co-err" role="alert">{error}</p>}
            <button className="btn green co-confirm" type="submit" disabled={busy || !method}>{busy ? <><Loader2 className="co-spin" /> Placing order…</> : `Confirm order · ${etb(sub + fee)}`}</button>
          </section>
        </aside>
      </form>
    </CoShell>
  );
}
