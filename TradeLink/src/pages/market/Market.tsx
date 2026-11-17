import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Check, ChevronRight, Download, Heart, LogIn, Menu, Package, Plus, Search, ShoppingBag, Store, Tag, Trash2, User, Briefcase, X, Layers, MessageCircle } from "lucide-react";
import { Brand } from "../../components/Brand";
import { ContactIcons } from "../../components/ContactActions";
import { money } from "../../lib/format";
import { IconFor } from "../../lib/icons";
import { lookFor } from "../../lib/theme";
import type { PublicCategory, PublicIndustry, PublicProduct } from "../../lib/supabase";
import "./market.css";

export type Mode = "business" | "individual";

/** Everything the marketplace sections need, worked out once by the page from the real catalogue. */
export type Shelf = {
  mode: Mode;
  products: PublicProduct[];            // products this buyer type may see
  industries: PublicIndustry[];
  categories: PublicCategory[];
  indOf: (p: PublicProduct) => PublicIndustry | undefined;
  catName: (p: PublicProduct) => string;
  isFashion: (p: PublicProduct) => boolean;
  bestIds: string[];
  inRequest: (id: string) => boolean;
  addToRequest: (p: PublicProduct) => void;
  wished: (id: string) => boolean;
  toggleWish: (id: string) => void;
  open: (p: PublicProduct) => void;
};

/** Fades a block in the first time it scrolls into view. */
export function Reveal({ children, className = "", as: Tag = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`mk-reveal${seen ? " in" : ""} ${className}`}>{children}</Tag>;
}

const tone = (name: string) => { const l = lookFor(name); return { "--ta": l.a, "--tt": l.tint, "--ti": l.ink } as CSSProperties; };

export function priceOf(p: PublicProduct) {
  const retail = p.retail_price && Number(p.retail_price) > 0 ? Number(p.retail_price) : null;
  const sale = retail !== null && p.sale_price && Number(p.sale_price) > 0 && Number(p.sale_price) < retail ? Number(p.sale_price) : null;
  return { now: sale ?? retail, was: sale !== null ? retail : null };
}

function Stock({ p }: { p: PublicProduct }) {
  if (!p.stock_status) return null;
  const t = p.stock_status === "in" ? "In stock" : p.stock_status === "low" ? "Few left" : "Sold out";
  return <span className={`mk-stock ${p.stock_status}`}><i />{t}</span>;
}

function Price({ p, mode }: { p: PublicProduct; mode: Mode }) {
  const { now, was } = priceOf(p);
  if (mode === "individual" && now !== null) return <span className="mk-price"><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}</span>;
  return <span className="mk-price ask"><Tag size={14} />Ask for price</span>;
}

/* ------------------------------------------------------------------ header */

export function MarketHeader({ industries, wishCount, requestCount, signedIn, canInstall, onInstall, onIndustry, onNav, onWishlist, onRequest, onAccount, onSearch, menuOpen, setMenuOpen }: {
  industries: PublicIndustry[]; wishCount: number; requestCount: number; signedIn: boolean; canInstall: boolean; onInstall: () => void;
  onIndustry: (i: PublicIndustry | null) => void; onNav: (id: string) => void; onWishlist: () => void; onRequest: () => void; onAccount: () => void; onSearch: () => void;
  menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const f = () => setSolid(window.scrollY > 4);
    f(); window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <header className={`mk-header${solid ? " solid" : ""}`}>
      <div className="mk-bar">
        <a href="#top" className="mk-logo" aria-label="TradeLink home" onClick={e => { e.preventDefault(); onNav("top"); }}><Brand /></a>
        <nav className="mk-nav" aria-label="Main">
          <a href="#industries" onClick={e => { e.preventDefault(); onNav("industries"); }}>Industries</a>
          <a href="#public-products" onClick={e => { e.preventDefault(); onNav("public-products"); }}>Shop</a>
          <a href="#contact" onClick={e => { e.preventDefault(); onNav("contact"); }}>Contact</a>
        </nav>
        <div className="mk-actions">
          <button className="mk-icon mk-sbtn" aria-label="Search" title="Search" onClick={onSearch}><Search size={19} /></button>
          <button className="mk-icon" aria-label={`Wishlist, ${wishCount} saved`} title="Wishlist" onClick={onWishlist}><Heart size={19} />{wishCount > 0 && <i key={wishCount}>{wishCount}</i>}</button>
          <button className="mk-icon" aria-label={`Price request, ${requestCount} ${requestCount === 1 ? "product" : "products"}`} title="Price request" onClick={onRequest}><ShoppingBag size={19} />{requestCount > 0 && <i key={requestCount}>{requestCount}</i>}</button>
          <button className="mk-icon mk-acct" aria-label={signedIn ? "Open admin" : "Staff sign in"} title={signedIn ? "Admin" : "Staff sign in"} onClick={onAccount}><User size={19} /></button>
          <button className="mk-icon mk-burger" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
      {industries.length > 0 && (
        <div className="mk-cats" role="navigation" aria-label="Industries">
          <div className="mk-cats-in">
            <button onClick={() => onIndustry(null)}><Layers size={15} />All</button>
            {industries.map(i => <button key={i.id} onClick={() => onIndustry(i)}><IconFor name={i.icon} size={15} />{i.name}</button>)}
          </div>
        </div>
      )}
      {menuOpen && (
        <div className="mk-menu" role="menu">
          <a href="#industries" role="menuitem" onClick={e => { e.preventDefault(); onNav("industries"); }}><Layers size={18} />Industries</a>
          <a href="#public-products" role="menuitem" onClick={e => { e.preventDefault(); onNav("public-products"); }}><Store size={18} />Shop</a>
          <a href="#contact" role="menuitem" onClick={e => { e.preventDefault(); onNav("contact"); }}><MessageCircle size={18} />Contact</a>
          <button role="menuitem" onClick={onAccount}><LogIn size={18} />{signedIn ? "Admin" : "Staff sign in"}</button>
          {canInstall && <button role="menuitem" className="mk-install" onClick={onInstall}><Download size={18} />Install app</button>}
        </div>
      )}
    </header>
  );
}

/* -------------------------------------------------------------------- hero */

type Hit =
  | { kind: "product"; p: PublicProduct; label: string; sub: string }
  | { kind: "industry"; i: PublicIndustry; label: string; sub: string }
  | { kind: "category"; c: PublicCategory; label: string; sub: string };

export function MarketHero({ shelf, onMode, query, setQuery, onSubmit, onPickIndustry, onPickCategory, searchRef }: {
  shelf: Shelf; onMode: (m: Mode) => void; query: string; setQuery: (q: string) => void; onSubmit: () => void;
  onPickIndustry: (i: PublicIndustry) => void; onPickCategory: (c: PublicCategory) => void; searchRef: React.RefObject<HTMLInputElement>;
}) {
  const [focus, setFocus] = useState(false);
  const q = query.trim().toLowerCase();
  const hits = useMemo<Hit[]>(() => {
    if (q.length < 2) return [];
    const out: Hit[] = [];
    for (const i of shelf.industries) if (i.name.toLowerCase().includes(q)) out.push({ kind: "industry", i, label: i.name, sub: "Industry" });
    for (const c of shelf.categories) if (c.name.toLowerCase().includes(q)) out.push({ kind: "category", c, label: c.name, sub: "Category" });
    const prods = shelf.products.filter(p => `${p.name} ${p.brand ?? ""} ${p.category}`.toLowerCase().includes(q)).slice(0, 5);
    for (const p of prods) out.push({ kind: "product", p, label: p.name, sub: [p.brand, shelf.catName(p)].filter(Boolean).join(" · ") });
    return out.slice(0, 8);
  }, [q, shelf]);
  const pick = (h: Hit) => {
    setFocus(false);
    if (h.kind === "product") shelf.open(h.p);
    else if (h.kind === "industry") onPickIndustry(h.i);
    else onPickCategory(h.c);
  };
  return (
    <section className="mk-hero" id="top">
      <div className="mk-wrap">
        <h1>Discover Everything. <span>Trade Everywhere.</span></h1>
        <p>Explore products and connect with businesses across multiple industries.</p>
        <div className="mk-searchbox">
          <form role="search" onSubmit={e => { e.preventDefault(); setFocus(false); onSubmit(); }}>
            <Search size={19} />
            <input ref={searchRef} type="search" value={query} onChange={e => { setQuery(e.target.value); setFocus(true); }} onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
              placeholder="Search products or brands" aria-label="Search products, categories or brands" autoComplete="off" />
            {query && <button type="button" className="mk-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={16} /></button>}
            <button className="mk-go" aria-label="Search"><ArrowRight size={18} /></button>
          </form>
          {focus && q.length >= 2 && (
            <ul className="mk-suggest" role="listbox">
              {hits.length === 0 && <li className="none">Nothing matches “{query.trim()}”.</li>}
              {hits.map((h, k) => (
                <li key={k}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(h)}>
                  <span className="ic">{h.kind === "industry" ? <IconFor name={h.i.icon} size={16} /> : h.kind === "category" ? <Layers size={16} /> : <Package size={16} />}</span>
                  <span className="tx"><b>{h.label}</b><small>{h.sub}</small></span><ChevronRight size={15} />
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <div className="mk-modes" role="group" aria-label="I am shopping as">
          <button className={shelf.mode === "individual" ? "on" : ""} aria-pressed={shelf.mode === "individual"} onClick={() => onMode("individual")}>
            <span className="ic"><User size={17} /></span><span><b>Individual</b><small>Personal shopping</small></span><Check className="ck" size={16} />
          </button>
          <button className={shelf.mode === "business" ? "on" : ""} aria-pressed={shelf.mode === "business"} onClick={() => onMode("business")}>
            <span className="ic"><Briefcase size={17} /></span><span><b>Business</b><small>Wholesale &amp; suppliers</small></span><Check className="ck" size={16} />
          </button>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- industries */

export function IndustryGrid({ items, onPick }: { items: { ind: PublicIndustry; count: number; note?: string }[]; onPick: (i: PublicIndustry) => void }) {
  if (items.length === 0) return null;
  return (
    <Reveal className="mk-block" as="section">
      <div className="mk-wrap" id="industries">
        <div className="mk-head"><h2>Industries</h2></div>
        <div className="mk-inds">
          {items.map(({ ind, count, note }, k) => (
            <button key={ind.id} className="mk-ind" style={{ ...tone(ind.name), "--k": k } as CSSProperties} onClick={() => onPick(ind)} title={ind.description ?? ind.name}>
              <span className="ic"><IconFor name={ind.icon} size={20} /></span>
              <b>{ind.name}</b>
              <small>{count > 0 ? `${count} ${count === 1 ? "product" : "products"}` : note ?? "Coming soon"}</small>
            </button>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

/* ------------------------------------------------------------------- cards */

export function MiniCard({ p, shelf }: { p: PublicProduct; shelf: Shelf }) {
  const ind = shelf.indOf(p);
  const added = shelf.inRequest(p.id);
  const wished = shelf.wished(p.id);
  const fashion = shelf.isFashion(p);
  return (
    <article className="mk-card">
      <button className="mk-media" onClick={() => shelf.open(p)} aria-label={`Details: ${p.name}`}>
        {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="ph"><IconFor name={ind?.icon} size={30} /></span>}
      </button>
      <button className={`mk-heart${wished ? " on" : ""}`} aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Save to wishlist"} onClick={() => shelf.toggleWish(p.id)}><Heart size={16} /></button>
      <div className="mk-info">
        <small className="mk-cat">{shelf.catName(p)}</small>
        <h3><button onClick={() => shelf.open(p)}>{p.name}</button></h3>
        <div className="mk-row"><Price p={p} mode={shelf.mode} /><Stock p={p} /></div>
        {fashion
          ? <a className="mk-add" href={`/clothing/${p.id}`} onClick={e => { e.preventDefault(); shelf.open(p); }}>View<ArrowRight size={15} /></a>
          : <button className={`mk-add${added ? " done" : ""}`} onClick={() => shelf.addToRequest(p)}>{added ? <><Check size={15} />Added</> : <><Plus size={15} />Add</>}</button>}
      </div>
    </article>
  );
}

/* ------------------------------------------------------ featured by industry */

export function Featured({ shelf, onViewAll, status, emptyText }: { shelf: Shelf; onViewAll: (i: PublicIndustry) => void; status: string; emptyText: string }) {
  const sections = useMemo(() => shelf.industries
    .map(ind => ({ ind, items: shelf.products.filter(p => shelf.indOf(p)?.id === ind.id).slice(0, 4), total: shelf.products.filter(p => shelf.indOf(p)?.id === ind.id).length }))
    .filter(s => s.items.length > 0), [shelf]);
  if (sections.length === 0) {
    return (
      <section className="mk-block"><div className="mk-wrap"><div className="mk-empty"><Package size={28} /><p>{status === "loading" ? "Loading products…" : emptyText}</p></div></div></section>
    );
  }
  return (
    <>
      {sections.map(({ ind, items, total }) => (
        <Reveal className="mk-block" as="section" key={ind.id}>
          <div className="mk-wrap" id={`ind-${ind.id}`}>
            <div className="mk-head" style={tone(ind.name)}>
              <h2><span className="ic"><IconFor name={ind.icon} size={17} /></span>{ind.name}</h2>
              <button className="mk-all" onClick={() => onViewAll(ind)}>View all{total > items.length ? ` (${total})` : ""}<ArrowRight size={15} /></button>
            </div>
            <div className="mk-grid">{items.map(p => <MiniCard key={p.id} p={p} shelf={shelf} />)}</div>
          </div>
        </Reveal>
      ))}
    </>
  );
}

/* --------------------------------------------------------- mixed discovery */

export function Popular({ shelf }: { shelf: Shelf }) {
  const [chip, setChip] = useState("all");
  const [more, setMore] = useState(1);
  const ranked = useMemo(() => {
    const rank = new Map(shelf.bestIds.map((id, i) => [id, i]));
    const best = shelf.products.filter(p => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
    const rest = shelf.products.filter(p => !rank.has(p.id)).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    return { list: [...best, ...rest], hasBest: best.length > 0 };
  }, [shelf.products, shelf.bestIds]);
  const chips = useMemo(() => shelf.industries.filter(i => ranked.list.some(p => shelf.indOf(p)?.id === i.id)), [shelf, ranked.list]);
  const active = chips.some(i => i.id === chip) ? chip : "all";
  const list = ranked.list.filter(p => active === "all" || shelf.indOf(p)?.id === active);
  const shown = list.slice(0, 8 * more);
  if (ranked.list.length === 0) return null;
  return (
    <Reveal className="mk-block" as="section">
      <div className="mk-wrap">
        <div className="mk-head"><h2>{ranked.hasBest ? "Popular products" : "Latest products"}</h2></div>
        {chips.length > 1 && (
          <div className="mk-chips" role="group" aria-label="Filter by industry">
            <button className={active === "all" ? "on" : ""} aria-pressed={active === "all"} onClick={() => { setChip("all"); setMore(1); }}>All</button>
            {chips.map(i => <button key={i.id} className={active === i.id ? "on" : ""} aria-pressed={active === i.id} onClick={() => { setChip(i.id); setMore(1); }}><IconFor name={i.icon} size={14} />{i.name}</button>)}
          </div>
        )}
        <div className="mk-grid" key={active}>{shown.map(p => <MiniCard key={p.id} p={p} shelf={shelf} />)}</div>
        {shown.length < list.length && <div className="mk-more"><button onClick={() => setMore(m => m + 1)}>Show more<Plus size={15} /></button></div>}
      </div>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ dialogs */

function useLock(on: boolean, close: () => void) {
  useEffect(() => {
    if (!on) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", k);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", k); };
  }, [on, close]);
}

export function ProductDialog({ p, shelf, onClose, onStore }: { p: PublicProduct; shelf: Shelf; onClose: () => void; onStore: (p: PublicProduct) => void }) {
  useLock(true, onClose);
  const ind = shelf.indOf(p);
  const wished = shelf.wished(p.id);
  const added = shelf.inRequest(p.id);
  const fashion = shelf.isFashion(p);
  return (
    <div className="mk-layer" role="dialog" aria-modal="true" aria-label={p.name}>
      <button className="mk-scrim" aria-label="Close" onClick={onClose} />
      <div className="mk-dialog">
        <button className="mk-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="mk-dmedia">{p.image_url ? <img src={p.image_url} alt={p.name} /> : <span className="ph"><IconFor name={ind?.icon} size={44} /></span>}</div>
        <div className="mk-dbody">
          <small className="mk-cat">{[ind?.name, shelf.catName(p)].filter(Boolean).join(" · ")}</small>
          <h3>{p.name}</h3>
          {p.brand && <p className="mk-brand">{p.brand}</p>}
          <div className="mk-row"><Price p={p} mode={shelf.mode} /><Stock p={p} /></div>
          {p.description && <p className="mk-desc">{p.description}</p>}
          <div className="mk-facts">
            <span><Package size={14} />{p.package_size || p.unit}</span>
            {shelf.mode === "business" && <span title="Minimum order"><Layers size={14} />Min {Number(p.min_order_quantity)} {p.unit}</span>}
          </div>
          <div className="mk-dact">
            {fashion
              ? <button className="mk-primary" onClick={() => onStore(p)}>Open in store<ArrowRight size={16} /></button>
              : <button className="mk-primary" onClick={() => { shelf.addToRequest(p); if (!added) onClose(); }}>{added ? <><Check size={16} />Added</> : <><Plus size={16} />Add to request</>}</button>}
            <button className={`mk-sq${wished ? " on" : ""}`} aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Save to wishlist"} onClick={() => shelf.toggleWish(p.id)}><Heart size={18} /></button>
          </div>
          <ContactIcons message={`Hello TradeLink, I would like ${shelf.mode === "individual" ? "a price" : "a wholesale price"} for ${p.name}.`} />
        </div>
      </div>
    </div>
  );
}

export function WishlistDrawer({ items, shelf, onClose }: { items: PublicProduct[]; shelf: Shelf; onClose: () => void }) {
  useLock(true, onClose);
  return (
    <div className="mk-layer side" role="dialog" aria-modal="true" aria-label="Wishlist">
      <button className="mk-scrim" aria-label="Close" onClick={onClose} />
      <aside className="mk-drawer">
        <header><h2><Heart size={18} />Wishlist</h2><button className="mk-x" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        {items.length === 0
          ? <div className="mk-empty"><Heart size={28} /><p>Tap the heart on a product to save it here.</p></div>
          : <ul>{items.map(p => (
              <li key={p.id}>
                <button className="th" onClick={() => { onClose(); shelf.open(p); }}>{p.image_url ? <img src={p.image_url} alt="" /> : <IconFor name={shelf.indOf(p)?.icon} size={22} />}</button>
                <div><b>{p.name}</b><Price p={p} mode={shelf.mode} /></div>
                <button className="rm" aria-label={`Remove ${p.name}`} onClick={() => shelf.toggleWish(p.id)}><Trash2 size={16} /></button>
              </li>))}</ul>}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------- footer */

export function MarketFooter({ industries, onIndustry, onRequest, onAccount, signedIn }: {
  industries: PublicIndustry[]; onIndustry: (i: PublicIndustry) => void; onRequest: () => void; onAccount: () => void; signedIn: boolean;
}) {
  return (
    <footer className="mk-footer" id="contact">
      <div className="mk-wrap mk-fgrid">
        <div className="mk-fbrand">
          <Brand light />
          <p>Products and suppliers across many industries.</p>
          <ContactIcons />
        </div>
        {industries.length > 0 && (
          <nav aria-label="Industries"><h4>Industries</h4>
            <ul>{industries.slice(0, 8).map(i => <li key={i.id}><button onClick={() => onIndustry(i)}>{i.name}</button></li>)}</ul>
          </nav>
        )}
        <nav aria-label="Support"><h4>Support</h4>
          <ul>
            <li><button onClick={onRequest}>Request a price</button></li>
            <li><a href="#public-products" onClick={e => { e.preventDefault(); document.getElementById("public-products")?.scrollIntoView({ behavior: "smooth" }); }}>Shop</a></li>
            <li><button onClick={onAccount}>{signedIn ? "Admin" : "Staff sign in"}</button></li>
          </ul>
        </nav>
      </div>
      <div className="mk-wrap mk-copy"><small>© {new Date().getFullYear()} TradeLink</small></div>
    </footer>
  );
}

