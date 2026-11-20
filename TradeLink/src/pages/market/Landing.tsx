import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, BadgePercent, Check, FileText, Gift, Grid3x3, Mail, Package, Send, ShieldCheck, Star, Store, Truck } from "lucide-react";
import { IconFor } from "../../lib/icons";
import { lookFor } from "../../lib/theme";
import { supabase, type PublicIndustry, type PublicProduct } from "../../lib/supabase";
import { Reveal } from "./Market";
import "./landing.css";

const tone = (name: string) => { const l = lookFor(name); return { "--ta": l.a, "--tt": l.tint, "--ti": l.ink } as CSSProperties; };

/** Reference-style hero: words on the left, real product photos on the right. Nothing here is invented: the discount badge only shows while a real sale price exists. */
export function LandingHero({ photos, offerPct, onShop, onQuote }: { photos: { id: string; src: string; name: string }[]; offerPct: number; onShop: () => void; onQuote: () => void }) {
  const [a, b, c] = photos;
  return (
    <section className="lp-hero" id="top" aria-label="Welcome">
      <div className="lp-wrap lp-hero-in">
        <div className="lp-copy">
          <p className="lp-eyebrow">Welcome to TradeLink</p>
          <h1>Wholesale and retail.<br />In one place.</h1>
          <p className="lp-script">Buy in bulk, or one at a time.</p>
          <p className="lp-lead">Browse products from TradeLink and its suppliers, then send a request and we reply with your price.</p>
          <div className="lp-cta">
            <button className="lp-btn solid" onClick={onShop}>Shop now</button>
            <button className="lp-btn line" onClick={onQuote}>Request a quote</button>
          </div>
          <ul className="lp-assure" aria-label="Why TradeLink">
            <li><Truck size={22} /><span><b>Delivery</b><small>Arranged for you</small></span></li>
            <li><FileText size={22} /><span><b>Written quotes</b><small>For every order</small></span></li>
            <li><ShieldCheck size={22} /><span><b>Checked suppliers</b><small>Reviewed by our team</small></span></li>
          </ul>
        </div>
        <div className="lp-stage" aria-hidden={photos.length === 0}>
          {photos.length === 0 && <span className="lp-mark"><Store size={150} strokeWidth={1.2} /></span>}
          {a && <figure className="p1"><img src={a.src} alt={a.name} loading="eager" /></figure>}
          {b && <figure className="p2"><img src={b.src} alt={b.name} loading="lazy" /></figure>}
          {c && <figure className="p3"><img src={c.src} alt={c.name} loading="lazy" /></figure>}
          {offerPct > 0 && <div className="lp-badge" role="note"><span>Up to</span><b>{offerPct}%</b><span>off</span></div>}
        </div>
      </div>
    </section>
  );
}

/** One evenly sized card per industry, then "More categories". */
export function BrowseCategories({ items, onPick, onMore }: { items: { ind: PublicIndustry; img: string | null; count: number }[]; onPick: (i: PublicIndustry) => void; onMore: () => void }) {
  if (items.length === 0) return null;
  return (
    <Reveal className="lp-sec" as="section">
      <div className="lp-wrap" id="categories">
        <h2 className="lp-h">Browse by category</h2>
        <div className="lp-cats">
          {items.slice(0, 7).map(({ ind, img, count }) => (
            <button key={ind.id} className="lp-cat" style={tone(ind.name)} onClick={() => onPick(ind)}>
              <span className="pic">{img ? <img src={img} alt="" loading="lazy" /> : <IconFor name={ind.icon} size={38} />}</span>
              <b>{ind.name}</b>{count > 0 && <small>{count} {count === 1 ? "product" : "products"}</small>}
            </button>
          ))}
          <button className="lp-cat more" onClick={onMore}><span className="pic"><Grid3x3 size={34} /></span><b>More categories</b></button>
        </div>
      </div>
    </Reveal>
  );
}

/** Three wide promotional banners. Offer figures come from live sale prices; the others describe how TradeLink really works. */
export function PromoBanners({ offerCount, offerPct, onOffers, onQuote, onSupplier }: { offerCount: number; offerPct: number; onOffers: () => void; onQuote: () => void; onSupplier: () => void }) {
  return (
    <Reveal className="lp-sec" as="section">
      <div className="lp-wrap">
        <div className="lp-promos">
          <article className="lp-promo navy">
            <span className="ico"><Package size={34} strokeWidth={1.6} /></span>
            <div><h3>Delivery to your door</h3><p>Tell us where you are when you send a request. We arrange the delivery for you.</p>
              <button onClick={onQuote}>Request a quote <ArrowRight size={16} /></button></div>
          </article>
          <article className="lp-promo blue">
            <span className="ico"><BadgePercent size={34} strokeWidth={1.6} /></span>
            <div><h3>Special offers</h3>
              <p>{offerCount > 0 ? `Save up to ${offerPct}% on ${offerCount} ${offerCount === 1 ? "product" : "products"} right now.` : "Ask for a bulk price on any product and we quote you directly."}</p>
              <button onClick={offerCount > 0 ? onOffers : onQuote}>{offerCount > 0 ? "See the offers" : "Ask for a price"} <ArrowRight size={16} /></button></div>
          </article>
          <article className="lp-promo soft">
            <span className="ico"><Gift size={34} strokeWidth={1.6} /></span>
            <div><h3>Member benefits</h3><p>Business buyers get wholesale prices and a written quote. Suppliers get their own dashboard to sell here.</p>
              <button onClick={onSupplier}>Become a supplier <ArrowRight size={16} /></button></div>
          </article>
        </div>
      </div>
    </Reveal>
  );
}

/** Real numbers only, plus the rating only once published reviews exist. The newsletter writes to the database. */
export function TrustNewsletter({ products, suppliers, industries }: { products: number; suppliers: number; industries: number }) {
  const [rating, setRating] = useState<{ avg: number; n: number } | null>(null);
  const [email, setEmail] = useState("");
  const [bot, setBot] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void supabase.from("public_product_ratings").select("average, reviews").then(({ data, error }) => {
      if (error || !data?.length) return;
      const n = data.reduce((a, r) => a + Number(r.reviews), 0);
      if (n > 0) setRating({ avg: data.reduce((a, r) => a + Number(r.average) * Number(r.reviews), 0) / n, n });
    });
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase || state === "busy") return;
    setState("busy"); setErr("");
    const { error } = await supabase.rpc("subscribe_newsletter", { p_email: email, p_website: bot });
    if (error) { setErr(error.message.includes("valid email") ? "Please enter a valid email address." : "We could not sign you up just now. Please try again."); setState("idle"); return; }
    setState("done");
  };
  const facts = [products > 0 && `${products} products`, suppliers > 0 && `${suppliers} ${suppliers === 1 ? "supplier" : "suppliers"}`, industries > 0 && `${industries} ${industries === 1 ? "industry" : "industries"}`].filter(Boolean) as string[];
  return (
    <Reveal className="lp-sec" as="section">
      <div className="lp-wrap">
        <div className="lp-trust">
          <div className="lp-t-left">
            <span className="ico"><ShieldCheck size={30} strokeWidth={1.7} /></span>
            <div>
              <h2>Buy with confidence</h2>
              <p>Suppliers are reviewed by our team, and every order starts with a written quote.</p>
              {facts.length > 0 && <ul className="facts">{facts.map(f => <li key={f}>{f}</li>)}</ul>}
              {rating && <p className="rate"><b>{rating.avg.toFixed(1)}/5</b> <span className="stars" aria-hidden="true">{[1, 2, 3, 4, 5].map(n => <Star key={n} size={15} fill={n <= Math.round(rating.avg) ? "currentColor" : "none"} />)}</span> from {rating.n} customer {rating.n === 1 ? "review" : "reviews"}</p>}
            </div>
          </div>
          <div className="lp-t-right">
            <h2>Get product news</h2>
            <p>New products and offers, sent to your inbox. No spam.</p>
            {state === "done" ? <p className="ok" role="status"><Check size={18} /> Thank you. You are subscribed.</p> : (
              <form onSubmit={e => void submit(e)} noValidate>
                <label className="sr" htmlFor="lp-news">Your email</label>
                <span className="field"><Mail size={18} /><input id="lp-news" type="email" inputMode="email" autoComplete="email" required maxLength={160} placeholder="Your email" value={email} onChange={e => setEmail(e.target.value)} /></span>
                <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={bot} onChange={e => setBot(e.target.value)} />
                <button className="lp-btn solid" disabled={state === "busy"}>{state === "busy" ? "Sending…" : <>Subscribe <Send size={15} /></>}</button>
              </form>
            )}
            {err && <p className="err" role="alert">{err}</p>}
          </div>
        </div>
      </div>
    </Reveal>
  );
}
