import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, BadgeCheck, Briefcase, Building2, ChevronRight, ChevronUp, ClipboardList, Clock, Download, Grid3x3, Heart, Mail, MapPin,
  Menu, MessageCircle, Package, Phone, Search, ShieldCheck, ShoppingBag, Store, Tag, User, X,
} from "lucide-react";
import { Brand } from "../../components/Brand";
import { ContactIcons } from "../../components/ContactActions";
import { useChannels, useContact } from "../../lib/contact";
import { money } from "../../lib/format";
import { IconFor } from "../../lib/icons";
import type { PublicCategory, PublicIndustry, PublicProduct, PublicSupplier } from "../../lib/supabase";
import { priceOf, type Mode, type Shelf } from "./Market";
import "./ref.css";

/* ------------------------------------------------------------ 1. announcement bar */

/** Only facts the marketplace really has: catalogue size, the phone saved in Admin, and the buyer-type switch. */
export function RefTopBar({ products, mode, onMode, onRfq }: { products: number; mode: Mode; onMode: (m: Mode) => void; onRfq: () => void }) {
  const c = useContact();
  return (
    <div className="rf-ann" role="region" aria-label="Marketplace information">
      <div className="rf-wrap rf-ann-in">
        <div className="rf-ann-l">{c.phone && <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}><Phone size={13} />{c.phone}</a>}</div>
        <span className="rf-ann-t"><Store size={14} />Wholesale and retail, one marketplace{products > 0 ? ` · ${products} products` : ""}</span>
        <div className="rf-ann-r">
          <div className="rf-seg" role="group" aria-label="I am buying as">
            <button aria-pressed={mode === "individual"} onClick={() => onMode("individual")}>Retail</button>
            <button aria-pressed={mode === "business"} onClick={() => onMode("business")}>Wholesale</button>
          </div>
          <button className="rf-ann-q" onClick={onRfq}>Get a quote</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 2. header */

type Hit =
  | { kind: "product"; p: PublicProduct; label: string; sub: string }
  | { kind: "industry"; i: PublicIndustry; label: string; sub: string }
  | { kind: "category"; c: PublicCategory; label: string; sub: string }
  | { kind: "supplier"; s: PublicSupplier; label: string; sub: string };

export function RefHeader({ shelf, suppliers, counts, wishCount, requestCount, signedIn, onWishlist, onRequest, onAccount, onSearch, onPickIndustry, onPickCategory, onSupplier, searchRef, menuOpen, setMenuOpen }: {
  shelf: Shelf; suppliers: PublicSupplier[]; counts: Map<string, number>; wishCount: number; requestCount: number; signedIn: boolean;
  onWishlist: () => void; onRequest: () => void; onAccount: () => void;
  onSearch: (q: string) => void; onPickIndustry: (i: PublicIndustry) => void; onPickCategory: (c: PublicCategory) => void; onSupplier: (s: PublicSupplier) => void;
  searchRef: React.RefObject<HTMLInputElement>; menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const root = useRef<HTMLElement>(null);
  const t = q.trim().toLowerCase();

  // The category menu closes on Escape or a click anywhere outside the header.
  useEffect(() => {
    if (!menuOpen) return;
    const off = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setMenuOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [menuOpen, setMenuOpen]);

  const hits = useMemo<Hit[]>(() => {
    if (t.length < 2) return [];
    const out: Hit[] = [];
    for (const i of shelf.industries) if (i.name.toLowerCase().includes(t)) out.push({ kind: "industry", i, label: i.name, sub: "Industry" });
    for (const c of shelf.categories) if (c.name.toLowerCase().includes(t)) out.push({ kind: "category", c, label: c.name, sub: "Category" });
    for (const s of suppliers) if (s.name.toLowerCase().includes(t)) out.push({ kind: "supplier", s, label: s.name, sub: s.location ? `Supplier · ${s.location}` : "Supplier" });
    for (const p of shelf.products.filter(p => `${p.name} ${p.brand ?? ""} ${p.category}`.toLowerCase().includes(t)).slice(0, 5)) out.push({ kind: "product", p, label: p.name, sub: [p.brand, shelf.catName(p)].filter(Boolean).join(" · ") });
    return out.slice(0, 9);
  }, [t, shelf, suppliers]);
  const pick = (h: Hit) => {
    setFocus(false);
    if (h.kind === "product") shelf.open(h.p); else if (h.kind === "industry") onPickIndustry(h.i);
    else if (h.kind === "category") onPickCategory(h.c); else onSupplier(h.s);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); setFocus(false); onSearch(q); };
  const placeholder = shelf.industries.length > 0 ? `Search ${shelf.industries.slice(0, 2).map(i => i.name.toLowerCase()).join(", ")}…` : "Search products";

  return (
    <header className="rf-head" ref={root}>
      <div className="rf-wrap rf-head-in">
        <button className="rf-burger" aria-label="Categories" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={24} /> : <Menu size={24} />}</button>
        <a href="#top" className="rf-logo" aria-label="TradeLink home" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Brand /></a>
        <div className="rf-search">
          <form role="search" onSubmit={submit}>
            <input ref={searchRef} type="search" value={q} onChange={e => { setQ(e.target.value); setFocus(true); }} onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
              placeholder={placeholder} aria-label="Search" autoComplete="off" />
            {q && <button type="button" className="clr" aria-label="Clear" onClick={() => { setQ(""); searchRef.current?.focus(); }}><X size={15} /></button>}
            <button className="go" aria-label="Search"><Search size={20} /></button>
          </form>
          {focus && t.length >= 2 && (
            <ul className="rf-suggest" role="listbox">
              {hits.length === 0 && <li className="none"><Search size={16} />No matches for “{q.trim()}”. Try a shorter word.</li>}
              {hits.map((h, k) => (
                <li key={k}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(h)}>
                  <span className="ic">{h.kind === "industry" ? <IconFor name={h.i.icon} size={16} /> : h.kind === "supplier" ? <Building2 size={16} /> : h.kind === "category" ? <Grid3x3 size={16} /> : <Package size={16} />}</span>
                  <span className="tx"><b>{h.label}</b><small>{h.sub}</small></span><ChevronRight size={15} />
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <div className="rf-acts">
          <button className="rf-act" onClick={onAccount} aria-label={signedIn ? "Admin" : "Sign in"}><User size={22} /><span>{signedIn ? "Admin" : "Account"}</span></button>
          <button className="rf-act" onClick={onWishlist} aria-label={`Wishlist, ${wishCount} saved`}><Heart size={22} /><span>Wishlist</span>{wishCount > 0 && <i key={wishCount}>{wishCount}</i>}</button>
          <button className="rf-act" onClick={onRequest} aria-label={`Price request, ${requestCount} ${requestCount === 1 ? "product" : "products"}`}><ShoppingBag size={22} /><span>Request</span><i key={requestCount} className={requestCount === 0 ? "zero" : ""}>{requestCount}</i></button>
        </div>
      </div>

      {menuOpen && (
        <div className="rf-mega" role="menu">
          <div className="rf-wrap rf-mega-in">
            {shelf.industries.map(i => {
              const cs = shelf.categories.filter(c => c.industry_id === i.id && (counts.get(c.id) ?? 0) > 0);
              return (
                <div className="col" key={i.id}>
                  <button className="h" onClick={() => { setMenuOpen(false); onPickIndustry(i); }}><span className="ic"><IconFor name={i.icon} size={17} /></span><b>{i.name}</b></button>
                  {cs.map(c => <button key={c.id} onClick={() => { setMenuOpen(false); onPickCategory(c); }}>{c.name}<em>{counts.get(c.id)}</em></button>)}
                  {cs.length === 0 && <small>Coming soon</small>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------- 3. category navigation */

export function RefNav({ industries, hasSale, onPickIndustry, onSale }: { industries: PublicIndustry[]; hasSale: boolean; onPickIndustry: (i: PublicIndustry) => void; onSale: () => void }) {
  if (industries.length === 0 && !hasSale) return null;
  return (
    <nav className="rf-nav" aria-label="Industries">
      <div className="rf-wrap rf-nav-in">
        {industries.slice(0, 9).map(i => <button key={i.id} onClick={() => onPickIndustry(i)}><IconFor name={i.icon} size={18} />{i.name}</button>)}
        {hasSale && <button className="sale" onClick={onSale}><Tag size={18} />Sale</button>}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------- 4. hero */

export type Slide = { ind: PublicIndustry; img: string | null; count: number };

export function RefHero({ slides, emptyText, onPickIndustry }: { slides: Slide[]; emptyText: string; onPickIndustry: (i: PublicIndustry) => void }) {
  const [n, setN] = useState(0);
  const [hold, setHold] = useState(false);
  const len = slides.length;
  useEffect(() => {
    if (len < 2 || hold || (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const t = window.setInterval(() => setN(v => (v + 1) % len), 5200);
    return () => window.clearInterval(t);
  }, [len, hold]);
  const at = Math.min(n, Math.max(0, len - 1));
  return (
    <section className="rf-hero" id="top" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} aria-roledescription="carousel">
      {len === 0 && (
        <div className="rf-slide on"><div className="rf-hero-in"><div className="rf-hero-copy">
          <small>Wholesale &amp; retail marketplace</small><h1>Everything you trade, in one place</h1><p>{emptyText}</p>
        </div></div></div>
      )}
      {slides.map((s, k) => (
        <div key={s.ind.id} className={`rf-slide${k === at ? " on" : ""}`} aria-hidden={k !== at}>
          {s.img ? <img src={s.img} alt="" loading={k === 0 ? "eager" : "lazy"} /> : <span className="wm"><IconFor name={s.ind.icon} size={300} /></span>}
          <div className="rf-hero-in"><div className="rf-hero-copy">
            <small>Wholesale &amp; retail marketplace</small>
            {k === 0 ? <h1>{s.ind.name}</h1> : <h2>{s.ind.name}</h2>}
            <p>{s.ind.description || `${s.count} ${s.count === 1 ? "product" : "products"} ready to order`}</p>
            <button className="rf-btn dark" tabIndex={k === at ? 0 : -1} onClick={() => onPickIndustry(s.ind)}>Shop {s.ind.name}<ArrowRight size={18} /></button>
          </div></div>
        </div>
      ))}
      {len > 1 && (
        <div className="rf-dots" role="tablist" aria-label="Banners">
          {slides.map((s, k) => <button key={s.ind.id} role="tab" aria-selected={k === at} aria-label={s.ind.name} className={k === at ? "on" : ""} onClick={() => setN(k)} />)}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------- 5. circular shortcuts */

export type Circle = { key: string; label: string; img: string | null; icon?: string | null; onClick: () => void };

export function RefCircles({ items }: { items: Circle[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rf-wrap" aria-label="Shop by category">
      <div className={`rf-circ${items.length < 7 ? " few" : ""}`}>
        {items.map(c => (
          <button key={c.key} onClick={c.onClick}>
            <span className="c">{c.img ? <img src={c.img} alt="" loading="lazy" /> : <IconFor name={c.icon} size={32} />}</span>
            <span className="l">{c.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- shared bits */

export function RefHead({ title, sub, onAll, allLabel = "View all" }: { title: string; sub?: string; onAll?: () => void; allLabel?: string }) {
  return (
    <div className="rf-sh">
      <h2>{title}</h2>{sub && <small>{sub}</small>}
      {onAll && <button onClick={onAll}>{allLabel}<ArrowRight size={15} /></button>}
    </div>
  );
}

const stockText = (s?: "in" | "low" | "out") => (s === "in" ? "In stock" : s === "low" ? "Few left" : s === "out" ? "Sold out" : null);
export const isFresh = (p: PublicProduct) => !!p.created_at && Date.now() - Date.parse(p.created_at) < 30 * 864e5;

/** One product card. The photo, name, price and a single detail line; the whole card opens the product. */
export function RefCard({ p, shelf, size = "lg", fresh = false }: { p: PublicProduct; shelf: Shelf; size?: "lg" | "md" | "sm"; fresh?: boolean }) {
  const wished = shelf.wished(p.id);
  const { now, was } = priceOf(p);
  const individual = shelf.mode === "individual";
  const off = individual && now !== null && was !== null ? Math.round((1 - now / was) * 100) : 0;
  const moq = Number(p.min_order_quantity);
  const stock = stockText(p.stock_status);
  const detail = [stock, !individual && moq > 1 ? `Min. ${moq} ${p.unit}` : p.package_size].filter(Boolean).join(" · ") || shelf.catName(p);
  return (
    <article className={`rf-card ${size}`}>
      <div className="m">
        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="ph"><IconFor name={shelf.indOf(p)?.icon} size={36} /></span>}
        {off > 0 ? <span className="bdg sale">-{off}%</span> : fresh ? <span className="bdg">New</span> : null}
        <button className={`heart${wished ? " on" : ""}`} aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Save to wishlist"} onClick={() => shelf.toggleWish(p.id)}><Heart size={size === "sm" ? 13 : 16} /></button>
      </div>
      <h3>{p.name}</h3>
      {individual && now !== null
        ? <p className="pr"><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}</p>
        : <p className="pr"><b className="ask">Ask for price</b></p>}
      <p className="mt">{stock && <i className={`dot ${p.stock_status}`} />}<span>{detail}</span></p>
      <button className="cover" aria-label={`Details: ${p.name}`} onClick={() => shelf.open(p)} />
    </article>
  );
}

export function RefSection({ id, title, sub, onAll, children }: { id?: string; title: string; sub?: string; onAll?: () => void; children: ReactNode }) {
  return (
    <section className="rf-wrap rf-sec" id={id}>
      <RefHead title={title} sub={sub} onAll={onAll} />
      {children}
    </section>
  );
}

/* ------------------------------------------------------ 7. promotional banners */

export function RefPromo({ kind, kicker, title, sub, cta, img, onClick }: { kind: "dark" | "light"; kicker?: string; title: string; sub: string; cta: string; img?: string | null; onClick: () => void }) {
  return (
    <div className={`rf-promo ${kind}`}>
      {img && <img src={img} alt="" loading="lazy" />}
      <div className="tx">
        {kicker && <small>{kicker}</small>}
        <h2>{title}</h2>
        <p>{sub}</p>
        <button className={`rf-btn ${kind === "dark" ? "cream" : "dark"}`} onClick={onClick}>{cta}<ArrowRight size={16} /></button>
      </div>
    </div>
  );
}

/** Industry tiles beside the best sellers. */
export function RefTiles({ items }: { items: { key: string; label: string; img: string | null; icon?: string | null; onClick: () => void }[] }) {
  return (
    <div className="rf-cur">
      {items.map(t => (
        <button key={t.key} onClick={t.onClick}>
          <span className="i">{t.img ? <img src={t.img} alt="" loading="lazy" /> : <IconFor name={t.icon} size={30} />}</span>
          <span className="l">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The green panel next to the personal picks: a real marketplace feature (supplier sign-up). */
export function RefSellPanel() {
  return (
    <aside className="rf-sell" aria-label="Sell on TradeLink">
      <Store className="wm" size={260} aria-hidden="true" />
      <h2>Sell on TradeLink</h2>
      <p>Open a supplier account and publish your products to wholesale and retail buyers.</p>
      <a className="rf-btn cream" href="/supplier/register">Become a supplier<ArrowRight size={16} /></a>
      <span className="tags"><BadgeCheck size={15} />Reviewed by our team</span>
    </aside>
  );
}

/* ------------------------------------------ 10. suppliers (in place of reviews) */

export function RefSuppliers({ items, industries, onOpen }: { items: PublicSupplier[]; industries: PublicIndustry[]; onOpen: (s: PublicSupplier) => void }) {
  if (items.length === 0) return null;
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
  return (
    <section className="rf-wrap rf-sec" id="suppliers">
      <RefHead title="Our suppliers" sub="Every supplier is approved before it sells" />
      <div className="rf-sups">
        {items.slice(0, 3).map(s => {
          const ind = industries.find(i => i.id === s.industry_id);
          return (
            <button key={s.id} className="rf-sup" onClick={() => onOpen(s)}>
              <span className="av">{initials(s.name)}</span>
              <span className="tx">
                <b>{s.name}</b>
                <small>{[ind?.name, s.location].filter(Boolean).join(" · ")}</small>
                {s.about && <span className="ab">{s.about}</span>}
                <em><BadgeCheck size={14} />Approved supplier</em>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- 11. shopping benefits */

export function RefBenefits() {
  const channels = useChannels();
  const items = [
    { Icon: Briefcase, t: "Wholesale & retail", s: "Choose how you buy" },
    { Icon: ShieldCheck, t: "Approved suppliers", s: "Checked before they sell" },
    { Icon: ClipboardList, t: "Request a quote", s: "Prices for bulk orders" },
    ...(channels.length > 0 ? [{ Icon: MessageCircle, t: "Chat to order", s: channels.map(c => c.label).join(", ") }] : []),
    { Icon: Heart, t: "Save favourites", s: "Wishlist on every product" },
  ];
  return (
    <section className="rf-wrap" aria-label="Shopping benefits">
      <ul className="rf-ben">
        {items.map(({ Icon, t, s }) => <li key={t}><span className="ic"><Icon size={24} /></span><span><b>{t}</b><small>{s}</small></span></li>)}
      </ul>
    </section>
  );
}

/* ----------------------------------------------- 12. quote band (in place of newsletter) */

export function RefQuoteBand({ onOpen, thumbs }: { onOpen: () => void; thumbs: string[] }) {
  return (
    <section className="rf-wrap">
      <div className="rf-quote">
        <div className="tx"><h2>Looking for products in bulk?</h2><p>Send your requirements and get a price from the team.</p></div>
        <div className="mid"><button className="rf-btn dark" onClick={onOpen}>Request a quote<ArrowRight size={18} /></button></div>
        {thumbs.length > 0 && <div className="thumbs" aria-hidden="true">{thumbs.slice(0, 3).map((u, k) => <img key={k} src={u} alt="" loading="lazy" />)}</div>}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- 13. footer */

export function RefFooter({ industries, onIndustry, onRequest, onAccount, signedIn, go, canInstall, onInstall, onWholesale }: {
  industries: PublicIndustry[]; onIndustry: (i: PublicIndustry) => void; onRequest: () => void; onAccount: () => void; signedIn: boolean;
  go: (id: string) => void; canInstall: boolean; onInstall: () => void; onWholesale: () => void;
}) {
  const c = useContact();
  const hasContact = !!(c.phone || c.email || c.address || c.hours);
  return (
    <footer className="rf-foot" id="contact">
      <div className="rf-wrap rf-foot-in">
        <div className="b">
          <Brand light />
          <p>Wholesale and retail, one marketplace.</p>
          <ContactIcons />
        </div>
        {industries.length > 0 && (
          <nav aria-label="Shop by industry"><h4>Shop</h4>
            <ul>{industries.slice(0, 6).map(i => <li key={i.id}><button onClick={() => onIndustry(i)}>{i.name}</button></li>)}</ul>
          </nav>
        )}
        <nav aria-label="Marketplace"><h4>Marketplace</h4>
          <ul>
            <li><button onClick={() => go("public-products")}>All products</button></li>
            <li><button onClick={onWholesale}>Wholesale</button></li>
            <li><button onClick={() => go("suppliers")}>Suppliers</button></li>
            <li><button onClick={onRequest}>Request a quote</button></li>
          </ul>
        </nav>
        <nav aria-label="Sellers and staff"><h4>Sell on TradeLink</h4>
          <ul>
            <li><a href="/supplier/register">Become a supplier</a></li>
            <li><a href="/supplier">Supplier portal</a></li>
            <li><a href="/login" onClick={e => { e.preventDefault(); onAccount(); }}>{signedIn ? "Admin" : "Staff sign in"}</a></li>
          </ul>
        </nav>
        {(hasContact || canInstall) && (
          <div className="ct"><h4>Contact</h4>
            <ul>
              {c.phone && <li><Phone size={14} /><a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</a></li>}
              {c.email && <li><Mail size={14} /><a href={`mailto:${c.email}`}>{c.email}</a></li>}
              {c.address && <li><MapPin size={14} /><span>{c.address}</span></li>}
              {c.hours && <li><Clock size={14} /><span>{c.hours}</span></li>}
            </ul>
            {canInstall && <button className="inst" onClick={onInstall}><Download size={16} />Install the app</button>}
          </div>
        )}
      </div>
      <div className="rf-wrap rf-foot-bar">
        <small>© {new Date().getFullYear()} TradeLink</small>
        <button type="button" onClick={() => go("top")} aria-label="Back to top"><ChevronUp size={16} />Back to top</button>
      </div>
    </footer>
  );
}

