import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, BadgePercent, Check, ChevronLeft, ChevronRight, FileText, Gift, Percent, Zap, Grid3x3, Mail, Package, Send, ShieldCheck, Star, Store, Truck } from "lucide-react";
import { IconFor } from "../../lib/icons";
import { lookFor } from "../../lib/theme";
import { supabase, type PublicIndustry, type PublicProduct } from "../../lib/supabase";
import { KIND_LABEL, etb, offerSub, offerText, timeLeft, type PublicPromo } from "../../lib/promo";
import { Reveal } from "./Market";
import "./landing.css";

const tone = (name: string) => { const l = lookFor(name); return { "--ta": l.a, "--tt": l.tint, "--ti": l.ink } as CSSProperties; };

/** Reference-style hero: words on the left, real product photos on the right. Nothing here is invented: the discount badge only shows while a real sale price exists. */
export type HeroPromo = { id: string; src: string; tag: string; title: string; body: string; cta: string; run: () => void };
export function LandingHero({ photos, offerPct, promos = [], slides = [], onShop, onQuote }: { photos: { id: string; src: string; name: string }[]; offerPct: number; promos?: HeroPromo[]; slides?: AdSlide[]; onShop: () => void; onQuote: () => void }) {
  const [pi, setPi] = useState(0);
  useEffect(() => { if (promos.length < 2) return; const t = window.setInterval(() => setPi(i => (i + 1) % promos.length), 6000); return () => window.clearInterval(t); }, [promos.length]);
  const promo = promos.length ? promos[pi % promos.length] : null;
  const [a, b, c] = photos;
  if (slides.length) return <AdStage slides={slides} onShop={onShop} onQuote={onQuote} />;
  return (
    <section className="lp-hero" id="top" aria-label="Welcome">
      <div className="lp-wrap lp-hero-in">
        <div className="lp-copy">
          <h1>Wholesale and retail.<br />In one place.</h1>
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
        {promo ? (
          <div className="lp-stage lp-hero-promo" role="group" aria-label="Promotion">
            <figure key={promo.id} className={promo.src ? "" : "nopic"}>{promo.src && <img src={promo.src} alt={promo.title} loading="eager" />}</figure>
            <div className="lp-promo-cap" key={"c" + promo.id}>
              <small>{promo.tag}</small><b>{promo.title}</b>{promo.body && <span>{promo.body}</span>}
              <button className="lp-btn solid" onClick={promo.run}>{promo.cta}</button>
            </div>
            {promos.length > 1 && <div className="lp-promo-dots">{promos.map((p, i) => <button key={p.id} aria-label={`Promotion ${i + 1}`} aria-current={i === pi % promos.length} onClick={() => setPi(i)} />)}</div>}
          </div>
        ) : (
        <div className="lp-stage" aria-hidden={photos.length === 0}>
          {photos.length === 0 && <span className="lp-mark"><Store size={150} strokeWidth={1.2} /></span>}
          {a && <figure className="p1"><img src={a.src} alt={a.name} loading="eager" /></figure>}
          {b && <figure className="p2"><img src={b.src} alt={b.name} loading="lazy" /></figure>}
          {c && <figure className="p3"><img src={c.src} alt={c.name} loading="lazy" /></figure>}
          {offerPct > 0 && <div className="lp-badge" role="note"><span>Up to</span><b>{offerPct}%</b><span>off</span></div>}
        </div>
        )}
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
        <div className="lp-head"><h2>Shop by category</h2><button className="lp-all" onClick={onMore}>View all <ArrowRight size={15} /></button></div>
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
    <Reveal className="lp-sec lp-strip" as="section">
      <div className="lp-wrap">
        <div className="lp-pcs">
          <article className="lp-pc navy">
            <span className="ico"><Package size={22} strokeWidth={1.6} /></span>
            <div><h3>Delivery to your door</h3><p>Tell us where you are when you send a request. We arrange the delivery for you.</p>
              <button onClick={onQuote}>Request a quote <ArrowRight size={16} /></button></div>
          </article>
          <article className="lp-pc blue">
            <span className="ico"><BadgePercent size={22} strokeWidth={1.6} /></span>
            <div><h3>Special offers</h3>
              <p>{offerCount > 0 ? `Save up to ${offerPct}% on ${offerCount} ${offerCount === 1 ? "product" : "products"} right now.` : "Ask for a bulk price on any product and we quote you directly."}</p>
              <button onClick={offerCount > 0 ? onOffers : onQuote}>{offerCount > 0 ? "See the offers" : "Ask for a price"} <ArrowRight size={16} /></button></div>
          </article>
          <article className="lp-pc soft">
            <span className="ico"><Gift size={22} strokeWidth={1.6} /></span>
            <div><h3>Member benefits</h3><p>Business buyers get wholesale prices and a written quote. Suppliers get their own dashboard to sell here.</p>
              <button onClick={onSupplier}>Become a supplier <ArrowRight size={16} /></button></div>
          </article>
        </div>
      </div>
    </Reveal>
  );
}

/** Explore more deals: one picture card per live campaign (two across on phones). Hidden when nothing is running. */
export function LivePromos({ items, supplierName, scopeText, onOpen, imageOf }: { items: PublicPromo[]; supplierName: (id: string | null) => string | undefined; scopeText: (p: PublicPromo) => string; onOpen: (p: PublicPromo) => void; imageOf?: (p: PublicPromo) => string | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const list = [...items].sort((a, b) => Number(b.show_banner) - Number(a.show_banner) || (a.ends_at ?? "9").localeCompare(b.ends_at ?? "9")).slice(0, 6);
  if (list.length === 0) return null;
  return (
    <Reveal className="lp-sec" as="section">
      <div className="lp-wrap" id="campaigns">
        <div className="lp-head"><h2>Explore more deals</h2></div>
        <div className="lp-deals">
          {list.map(p => {
            const left = p.ends_at ? timeLeft(p.ends_at, now) : "";
            const who = p.supplier_id ? supplierName(p.supplier_id) : undefined;
            const img = imageOf?.(p);
            return (
              <button key={p.id} className={`lp-deal k-${p.kind}${img ? "" : " nopic"}`} onClick={() => onOpen(p)} aria-label={`${p.name}: ${offerText(p)}`}>
                {img && <img src={img} alt="" loading="lazy" decoding="async" />}
                <span className="badge">{offerText(p)}</span>
                {left && <span className={`left${p.kind === "flash" ? " hot" : ""}`}>{left}</span>}
                <span className="cap"><small>{KIND_LABEL[p.kind]}{who ? ` · ${who}` : ""}</small><b>{p.name}</b><em>{p.banner_text || [scopeText(p), offerSub(p)].filter(Boolean).join(" · ")}</em></span>
              </button>
            );
          })}
        </div>
      </div>
    </Reveal>
  );
}

/** Wide picture banners from the admin's Homepage banner scenes. */
export function WideBanners({ items }: { items: { id: string; src: string; title: string; run: () => void }[] }) {
  if (items.length === 0) return null;
  return (
    <Reveal className="lp-sec" as="section">
      <div className="lp-wrap lp-wides">
        {items.map(b => <button key={b.id} className="lp-wide" onClick={b.run} aria-label={b.title}><img src={b.src} alt="" loading="lazy" decoding="async" /><span>{b.title}</span></button>)}
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


/** One advertisement in the homepage stage. Everything in it comes from a live promotion, a real sale price or an admin banner. */
export type AdSlide = {
  id: string; tag: string; title: string; name: string; body?: string;
  /** Sharp product photo, shown large on a soft backdrop. */
  image: string;
  /** A picture or video an admin added for this campaign: shown edge to edge instead. */
  cover?: string; video?: string;
  price?: number | null; was?: number | null; endsAt?: string | null;
  cta: string; run: () => void;
};

const useNow = (on: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!on) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [on]);
  return now;
};

function Countdown({ endsAt }: { endsAt: string }) {
  const now = useNow(true);
  const ms = new Date(endsAt).getTime() - now;
  if (!(ms > 0)) return null;
  const sec = Math.floor(ms / 1000), d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
  const cells: [number, string][] = d > 0 ? [[d, "days"], [h, "hrs"], [m, "min"], [x, "sec"]] : [[h, "hrs"], [m, "min"], [x, "sec"]];
  return (
    <div className="ad-time" role="timer" aria-label="Time left">
      {cells.map(([n, l]) => <span key={l}><b>{String(n).padStart(2, "0")}</b><small>{l}</small></span>)}
    </div>
  );
}

const SLIDE_MS = 8000;
/** The big advertising area: full-width HD picture or video, the offer, a live countdown and one button. Rotates by itself. */
export function AdStage({ slides, onShop, onQuote }: { slides: AdSlide[]; onShop: () => void; onQuote: () => void }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const at = i % n;
  useEffect(() => {
    if (n < 2 || paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setTimeout(() => setI(v => (v + 1) % n), SLIDE_MS);
    return () => window.clearTimeout(t);
  }, [n, paused, at]);
  const s = slides[at];
  const pct = s.price && s.was && s.was > s.price ? Math.round((1 - s.price / s.was) * 100) : 0;
  const go = (d: number) => setI(v => (v + d + n) % n);
  const touch = useRef(0);
  return (
    <section className="ad" id="top" aria-label="Offers">
      <div className="lp-wrap">
        <div className={`ad-stage${s.video || s.cover ? " media" : ""}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
          onTouchStart={e => { touch.current = e.touches[0].clientX; }} onTouchEnd={e => { const d = e.changedTouches[0].clientX - touch.current; if (n > 1 && Math.abs(d) > 50) go(d < 0 ? 1 : -1); }}>
          <div className="ad-bg" key={`b${s.id}`} aria-hidden="true">
            {s.video ? <video src={s.video} poster={s.image || s.cover} autoPlay muted loop playsInline preload="auto" />
              : <img src={s.cover || s.image} alt="" />}
          </div>
          <div className="ad-shade" aria-hidden="true" />
          {!s.video && !s.cover && s.image && <figure className="ad-pic" key={`p${s.id}`}><img src={s.image} alt={s.name} decoding="async" /></figure>}
          <div className="ad-copy" key={`c${s.id}`}>
            <span className="ad-tag">{s.tag}</span>
            <h2 className="ad-off">{s.title}</h2>
            {s.name && <p className="ad-name">{s.name}</p>}
            {s.body && s.body !== s.name && <p className="ad-body">{s.body}</p>}
            {s.price != null && s.price > 0 && (
              <p className="ad-price"><b>{etb(s.price)}</b>{s.was != null && s.was > s.price && <><s>{etb(s.was)}</s>{pct > 0 && <em>-{pct}%</em>}</>}</p>
            )}
            {s.endsAt && <Countdown endsAt={s.endsAt} />}
            <button className="ad-cta" onClick={s.run}>{s.cta} <ArrowRight size={18} /></button>
          </div>
          {n > 1 && (
            <>
              <button className="ad-arrow prev" onClick={() => go(-1)} aria-label="Previous offer"><ChevronLeft size={22} /></button>
              <button className="ad-arrow next" onClick={() => go(1)} aria-label="Next offer"><ChevronRight size={22} /></button>
              <div className="ad-dots" role="tablist" aria-label="Offers">
                {slides.map((x, k) => (
                  <button key={x.id} role="tab" aria-selected={k === at} aria-label={`Offer ${k + 1}`} className={k === at ? "on" : ""} onClick={() => setI(k)}>
                    <i className={k === at && !paused ? "run" : ""} style={{ animationDuration: `${SLIDE_MS}ms` }} />
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="ad-strip">
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
      </div>
    </section>
  );
}
