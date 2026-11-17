import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowRight, Building2, Check, MapPin, ChevronRight, ClipboardList, Clock, Download, Eye, Flame, Headphones, Heart, LogIn, Menu, Package, Plus, Search, ShoppingBag, Store, Sparkles, Tag, Trash2, User, Briefcase, X, Layers, MessageCircle, ArrowUpDown, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Brand, LogoMark } from "../../components/Brand";
import { ContactIcons } from "../../components/ContactActions";
import { money } from "../../lib/format";
import { IconFor } from "../../lib/icons";
import { lookFor } from "../../lib/theme";
import type { PublicCategory, PublicIndustry, PublicProduct, PublicSupplier } from "../../lib/supabase";
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

const tone = (name: string) => { const l = lookFor(name); return { "--ta": l.a, "--tt": l.tint, "--ti": l.ink, "--tp": l.pat } as CSSProperties; };

/** A small dot arcs from the pressed button to the request bag in the header. */
export function flyToBag(from: HTMLElement, target = '.mk-actions [aria-label^="Price request"]') {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const to = document.querySelector<HTMLElement>(target);
  if (!to || !from.animate) return;
  const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
  const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const dot = document.createElement("i");
  dot.setAttribute("aria-hidden", "true");
  Object.assign(dot.style, { position: "fixed", left: `${a.left + a.width / 2 - 9}px`, top: `${a.top + a.height / 2 - 9}px`, width: "18px", height: "18px", borderRadius: "50%", background: "linear-gradient(135deg,#3aa0e6,#0b5a96)", boxShadow: "0 6px 16px #0b5a9680", zIndex: "90", pointerEvents: "none" });
  document.body.appendChild(dot);
  const anim = dot.animate([
    { transform: "translate(0,0) scale(1)", opacity: 1 },
    { transform: `translate(${dx * 0.5}px,${dy * 0.5 - 70}px) scale(1.15)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px,${dy}px) scale(.25)`, opacity: 0.4 },
  ], { duration: 720, easing: "cubic-bezier(.4,.1,.6,1)" });
  anim.onfinish = () => dot.remove();
  anim.oncancel = () => dot.remove();
}

export function priceOf(p: PublicProduct) {
  const retail = p.retail_price && Number(p.retail_price) > 0 ? Number(p.retail_price) : null;
  const sale = retail !== null && p.sale_price && Number(p.sale_price) > 0 && Number(p.sale_price) < retail ? Number(p.sale_price) : null;
  return { now: sale ?? retail, was: sale !== null ? retail : null };
}

function Stock({ p }: { p: PublicProduct }) {
  if (!p.stock_status) return null;
  const t = p.stock_status === "in" ? "In stock" : p.stock_status === "low" ? "Few left" : "Sold out";
  return <span className={`mk-stock ${p.stock_status}`} title={t} role="img" aria-label={t}><i /></span>;
}

function Price({ p, mode }: { p: PublicProduct; mode: Mode }) {
  const { now, was } = priceOf(p);
  if (mode === "individual" && now !== null) return <span className="mk-price"><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}</span>;
  return <span className="mk-price ask" title="Ask for price" role="img" aria-label="Ask for price"><Tag size={15} /></span>;
}

/* ------------------------------------------------------------------ header */

export function MarketHeader({ industries, wishCount, requestCount, signedIn, canInstall, onInstall, onIndustry, onNav, onWishlist, onRequest, onAccount, onSearch, menuOpen, setMenuOpen }: {
  industries: PublicIndustry[]; wishCount: number; requestCount: number; signedIn: boolean; canInstall: boolean; onInstall: () => void;
  onIndustry: (i: PublicIndustry | null) => void; onNav: (id: string) => void; onWishlist: () => void; onRequest: () => void; onAccount: () => void; onSearch: () => void;
  menuOpen: boolean; setMenuOpen: (v: boolean) => void;
}) {
  const [solid, setSolid] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const f = () => {
      raf = 0;
      setSolid(window.scrollY > 6);
      const h = document.documentElement.scrollHeight - innerHeight;
      bar.current?.style.setProperty("--p", String(h > 0 ? Math.min(1, window.scrollY / h) : 0));
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(f); };
    f(); window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return (
    <header className={`mk-header${solid ? " solid" : ""}`}>
      <div className="mk-progress" ref={bar} aria-hidden="true" />
      <div className="mk-bar">
        <a href="#top" className="mk-logo" aria-label="TradeLink home" onClick={e => { e.preventDefault(); onNav("top"); }}><Brand /></a>
        <nav className="mk-nav" aria-label="Main">
          <a href="#industries" title="Industries" aria-label="Industries" onClick={e => { e.preventDefault(); onNav("industries"); }}><Layers size={19} /></a>
          <a href="#public-products" title="Shop" aria-label="Shop" onClick={e => { e.preventDefault(); onNav("public-products"); }}><Store size={19} /></a>
          <a href="#contact" title="Contact" aria-label="Contact" onClick={e => { e.preventDefault(); onNav("contact"); }}><MessageCircle size={19} /></a>
        </nav>
        <div className="mk-actions">
          <button className="mk-icon mk-sbtn" aria-label="Search" title="Search" onClick={onSearch}><Search size={19} /></button>
          <button className="mk-icon" aria-label={`Wishlist, ${wishCount} saved`} title="Wishlist" onClick={onWishlist}><Heart size={19} />{wishCount > 0 && <i key={wishCount}>{wishCount}</i>}</button>
          <button className="mk-icon" aria-label={`Price request, ${requestCount} ${requestCount === 1 ? "product" : "products"}`} title="Price request" onClick={onRequest}><ShoppingBag size={19} />{requestCount > 0 && <i key={requestCount}>{requestCount}</i>}</button>
          <button className="mk-icon mk-acct" aria-label={signedIn ? "Open admin" : "Staff sign in"} title={signedIn ? "Admin" : "Staff sign in"} onClick={onAccount}><User size={19} /></button>
          <button className="mk-icon mk-burger" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </div>
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

/** Cycles through real industry names so the headline speaks to whoever is reading it. */
function Rotator({ items }: { items: PublicIndustry[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (items.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = window.setInterval(() => setI(n => n + 1), 2300);
    return () => window.clearInterval(t);
  }, [items.length]);
  if (items.length === 0) return null;
  const cur = items[i % items.length];
  return (
    <div className="mk-rot" style={tone(cur.name)} aria-hidden="true">
      <span className="lead"><ShoppingBag size={15} /></span>
      <span className="word" key={cur.id}><span className="ic"><IconFor name={cur.icon} size={16} /></span>{cur.name}</span>
    </div>
  );
}

/** Slow-turning ring of industry icons around the TradeLink mark. */
function Orbit({ items }: { items: PublicIndustry[] }) {
  const ring = items.slice(0, 8);
  if (ring.length === 0) return null;
  return (
    <div className="mk-orbit" aria-hidden="true">
      <i className="pulse" /><i className="pulse two" />
      <div className="core"><LogoMark size={64} /></div>
      <div className="ring">
        {ring.map((ind, k) => (
          <span key={ind.id} className="sat" style={{ ...tone(ind.name), "--a": `${(360 / ring.length) * k}deg`, "--d": `${k * -1.3}s` } as CSSProperties}>
            <span className="bub"><IconFor name={ind.icon} size={22} /></span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Endless strip of every industry; pauses on hover so it is easy to tap. */
function Marquee({ items, onPick }: { items: PublicIndustry[]; onPick: (i: PublicIndustry) => void }) {
  if (items.length === 0) return null;
  const loop = items.length < 6 ? [...items, ...items, ...items, ...items] : [...items, ...items];
  return (
    <div className="mk-marq" role="navigation" aria-label="Industries">
      <div className="track">
        {loop.concat(loop).map((ind, k) => {
          const dupe = k >= items.length;
          return (
            <button key={k} style={tone(ind.name)} onClick={() => onPick(ind)} tabIndex={dupe ? -1 : 0} aria-hidden={dupe || undefined}>
              <span className="ic"><IconFor name={ind.icon} size={16} /></span>{ind.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
      <div className="mk-aurora" aria-hidden="true"><i /><i /><i /></div>
      <div className="mk-wrap mk-hero-grid">
        <div className="mk-copy">
          <h1>Discover Everything. <span>Trade Everywhere.</span></h1>
          <Rotator items={shelf.industries} />
          <div className="mk-searchbox">
            <form role="search" onSubmit={e => { e.preventDefault(); setFocus(false); onSubmit(); }}>
              <Search size={20} />
              <input ref={searchRef} type="search" value={query} onChange={e => { setQuery(e.target.value); setFocus(true); }} onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
                placeholder="What are you looking for?" aria-label="Search products, categories or brands" autoComplete="off" />
              {query && <button type="button" className="mk-clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}><X size={16} /></button>}
              <button className="mk-go" aria-label="Search"><ArrowRight size={19} /></button>
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
          <div className={`mk-switch ${shelf.mode}`} role="group" aria-label="I am shopping as">
            <i className="thumb" aria-hidden="true" />
            <button aria-pressed={shelf.mode === "individual"} onClick={() => onMode("individual")}><User size={18} />Individual</button>
            <button aria-pressed={shelf.mode === "business"} onClick={() => onMode("business")}><Briefcase size={18} />Business</button>
          </div>
        </div>
        <Orbit items={shelf.industries} />
      </div>
      <Marquee items={shelf.industries} onPick={onPickIndustry} />
    </section>
  );
}

/* --------------------------------------------------------------- industries */

export function IndustryGrid({ items, onPick }: { items: { ind: PublicIndustry; count: number; note?: string }[]; onPick: (i: PublicIndustry) => void }) {
  if (items.length === 0) return null;
  return (
    <Reveal className="mk-block" as="section">
      <div className="mk-wrap" id="industries">
        <div className="mk-inds">
          {items.map(({ ind, count, note }, k) => (
            <button key={ind.id} className="mk-ind" style={{ ...tone(ind.name), "--k": k } as CSSProperties} onClick={() => onPick(ind)} title={ind.description ?? ind.name}>
              <span className="wm" aria-hidden="true"><IconFor name={ind.icon} size={84} /></span>
              <span className="ic"><IconFor name={ind.icon} size={22} /></span>
              <b>{ind.name}</b>
              {count > 0
                ? <small className="n" title={`${count} ${count === 1 ? "product" : "products"}`}><Package size={12} />{count}</small>
                : note
                  ? <small className="n alt" title={note}>{note.startsWith("Wholesale") ? <Briefcase size={12} /> : <User size={12} />}</small>
                  : <small className="n alt" title="Coming soon"><Clock size={12} /></small>}
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
  const { now, was } = priceOf(p);
  const off = now !== null && was !== null ? Math.round((1 - now / was) * 100) : 0;
  const style = tone(ind?.name ?? shelf.catName(p));
  const glow = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <article className={`mk-card${added ? " in-bag" : ""}`} style={style} onPointerMove={glow}>
      <i className="mk-glow" aria-hidden="true" />
      <div className="mk-mwrap">
        <button className="mk-media" onClick={() => shelf.open(p)} aria-label={`Details: ${p.name}`}>
          {p.image_url ? <img src={p.image_url} alt="" loading="lazy" /> : <span className="ph"><IconFor name={ind?.icon} size={34} /></span>}
        </button>
        <div className="mk-tags">
          <Stock p={p} />
          {off > 0 && <span className="mk-off" title={`${off}% off`}>-{off}%</span>}
        </div>
        <button className={`mk-heart${wished ? " on" : ""}`} aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Save to wishlist"} onClick={() => shelf.toggleWish(p.id)}><Heart size={16} /></button>
        <button className="mk-peek" aria-label={`Quick look: ${p.name}`} title="Quick look" onClick={() => shelf.open(p)}><Eye size={17} /></button>
      </div>
      <div className="mk-info">
        <small className="mk-cat"><IconFor name={ind?.icon} size={12} />{shelf.catName(p)}</small>
        <h3><button onClick={() => shelf.open(p)}>{p.name}</button></h3>
        <div className="mk-row">
          <Price p={p} mode={shelf.mode} />
          {fashion
            ? <button className="mk-add" aria-label={`View ${p.name}`} title="View" onClick={() => shelf.open(p)}><ArrowRight size={18} /></button>
            : <button className={`mk-add${added ? " done" : ""}`} aria-label={added ? "Added to request" : `Add ${p.name} to request`} title={added ? "Added" : "Add to request"}
                onClick={e => { if (!added) flyToBag(e.currentTarget); shelf.addToRequest(p); }}>{added ? <Check size={18} /> : <Plus size={18} />}</button>}
        </div>
      </div>
    </article>
  );
}


/* ------------------------------------------------------ the big shop: departments + one grid */

type SortKey = "new" | "az" | "low" | "high";
const PAGE = 20;

export function MarketShop({ shelf, onMode, industries, categories, counts, industry, category, setIndustry, setCategory, search, setSearch, items, emptyText }: {
  shelf: Shelf; onMode: (m: Mode) => void; industries: PublicIndustry[]; categories: PublicCategory[]; counts: Map<string, number>;
  industry: string; category: string; setIndustry: (id: string) => void; setCategory: (id: string) => void;
  search: string; setSearch: (s: string) => void; items: PublicProduct[]; emptyText: string;
}) {
  const [sort, setSort] = useState<SortKey>("new");
  const [limit, setLimit] = useState(PAGE);
  const [deptOpen, setDeptOpen] = useState(false);
  useEffect(() => setLimit(PAGE), [industry, category, search, sort, shelf.mode]);
  const indCount = (id: string) => categories.filter(c => c.industry_id === id).reduce((n, c) => n + (counts.get(c.id) ?? 0), 0);
  const total = industries.reduce((n, i) => n + indCount(i.id), 0);
  const sorted = useMemo(() => {
    const a = [...items];
    if (sort === "az") a.sort((x, y) => x.name.localeCompare(y.name));
    else if (sort === "low" || sort === "high") {
      a.sort((x, y) => ((priceOf(x).now ?? Infinity) - (priceOf(y).now ?? Infinity)) * (sort === "low" ? 1 : -1));
    }
    return a;
  }, [items, sort]);
  const activeInd = industries.find(i => i.id === industry);
  const activeCat = categories.find(c => c.id === category);
  const choose = (i: string, c = "all") => { setIndustry(i); setCategory(c); setDeptOpen(false); };
  return (
    <section className="mk-shop" id="public-products" aria-label="Shop">
      <div className="mk-wrap mk-shop-in">
        <aside className={`mk-dept${deptOpen ? " open" : ""}`} aria-label="Departments">
          <button className="mk-dept-head" aria-expanded={deptOpen} onClick={() => setDeptOpen(o => !o)}>
            <span><SlidersHorizontal size={18} /></span><b>{activeCat?.name ?? activeInd?.name ?? "All"}</b><ChevronDown size={18} />
          </button>
          <div className="mk-dept-list">
            <button className={`mk-dept-row${industry === "all" ? " on" : ""}`} aria-pressed={industry === "all"} onClick={() => choose("all")}>
              <span className="ic"><Store size={18} /></span><b>All</b><em>{total}</em>
            </button>
            {industries.map(i => {
              const on = industry === i.id;
              const cs = categories.filter(c => c.industry_id === i.id && (counts.get(c.id) ?? 0) > 0);
              return (
                <div key={i.id} className={`mk-dept-grp${on ? " open" : ""}`} style={tone(i.name)}>
                  <button className={`mk-dept-row${on && category === "all" ? " on" : ""}`} aria-pressed={on && category === "all"} onClick={() => choose(i.id)}>
                    <span className="ic"><IconFor name={i.icon} size={18} /></span><b>{i.name}</b><em>{indCount(i.id)}</em>
                  </button>
                  {on && cs.length > 1 && (
                    <div className="mk-dept-sub">
                      {cs.map(c => <button key={c.id} className={category === c.id ? "on" : ""} aria-pressed={category === c.id} onClick={() => choose(i.id, category === c.id ? "all" : c.id)}>{c.name}<em>{counts.get(c.id)}</em></button>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <div className="mk-shop-main">
          <div className="mk-shop-bar">
            <label className="mk-shop-search"><Search size={18} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search" aria-label="Search products" />{search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={15} /></button>}</label>
            <label className="mk-sort" title="Sort"><ArrowUpDown size={17} />
              <select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort products">
                <option value="new">Newest</option><option value="az">A – Z</option>
                {shelf.mode === "individual" && <><option value="low">Price: low to high</option><option value="high">Price: high to low</option></>}
              </select>
            </label>
            <div className={`mk-switch mk-shop-mode ${shelf.mode}`} role="group" aria-label="I am buying as">
              <i className="thumb" aria-hidden="true" />
              <button aria-pressed={shelf.mode === "individual"} aria-label="Individual" title="Individual" onClick={() => onMode("individual")}><User size={17} /></button>
              <button aria-pressed={shelf.mode === "business"} aria-label="Business" title="Business" onClick={() => onMode("business")}><Briefcase size={17} /></button>
            </div>
          </div>
          <div className="mk-shop-now" aria-live="polite">
            <span className="n"><Package size={16} />{items.length}</span>
            {activeInd && <button className="chip" onClick={() => choose("all")}><IconFor name={activeInd.icon} size={14} />{activeInd.name}<X size={13} /></button>}
            {activeCat && <button className="chip" onClick={() => choose(industry)}>{activeCat.name}<X size={13} /></button>}
            {search && <button className="chip" onClick={() => setSearch("")}><Search size={13} />{search}<X size={13} /></button>}
          </div>
          {sorted.length === 0 ? <p className="mk-empty">{emptyText}</p> : (
            <>
              <div className="mk-grid mk-shop-grid">{sorted.slice(0, limit).map(p => <MiniCard key={p.id} p={p} shelf={shelf} />)}</div>
              {sorted.length > limit && <button className="mk-more" onClick={() => setLimit(l => l + PAGE)}><Plus size={18} /><b>{sorted.length - limit}</b></button>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------ featured by industry */

/** Swipeable row of cards; arrows appear on wide screens. */
function Rail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: true, r: false });
  const upd = () => {
    const el = ref.current; if (!el) return;
    setEdge({ l: el.scrollLeft < 4, r: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(() => { upd(); const el = ref.current; if (!el) return; const ro = new ResizeObserver(upd); ro.observe(el); return () => ro.disconnect(); }, []);
  const go = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth * 0.8), behavior: "smooth" });
  return (
    <div className="mk-railwrap">
      <div className="mk-rail" ref={ref} onScroll={upd}>{children}</div>
      {!edge.l && <button className="mk-rarrow l" aria-label="Previous" onClick={() => go(-1)}><ChevronRight size={20} style={{ transform: "scaleX(-1)" }} /></button>}
      {!edge.r && <button className="mk-rarrow r" aria-label="Next" onClick={() => go(1)}><ChevronRight size={20} /></button>}
    </div>
  );
}

export function Featured({ shelf, onViewAll, status, emptyText }: { shelf: Shelf; onViewAll: (i: PublicIndustry) => void; status: string; emptyText: string }) {
  const sections = useMemo(() => shelf.industries
    .map(ind => ({ ind, items: shelf.products.filter(p => shelf.indOf(p)?.id === ind.id).slice(0, 10), total: shelf.products.filter(p => shelf.indOf(p)?.id === ind.id).length }))
    .filter(s => s.items.length > 0), [shelf]);
  if (sections.length === 0) {
    return (
      <section className="mk-block"><div className="mk-wrap"><div className="mk-empty" role="status" aria-label={status === "loading" ? "Loading products" : emptyText}><Package size={34} /></div></div></section>
    );
  }
  return (
    <>
      {sections.map(({ ind, items, total }) => (
        <Reveal className="mk-block" as="section" key={ind.id}>
          <div className="mk-wrap" id={`ind-${ind.id}`}>
            <div className="mk-head" style={tone(ind.name)}>
              <h2><span className="ic"><IconFor name={ind.icon} size={17} /></span>{ind.name}</h2>
              <button className="mk-all" aria-label={`View all ${ind.name}`} title="View all" onClick={() => onViewAll(ind)}>{total > items.length && <b>{total}</b>}<ArrowRight size={16} /></button>
            </div>
            <Rail>{items.map(p => <MiniCard key={p.id} p={p} shelf={shelf} />)}</Rail>
          </div>
        </Reveal>
      ))}
    </>
  );
}

/* ------------------------------------------------------------- suppliers */
/** Real businesses from the suppliers directory (Admin → Suppliers). Hidden when there are none. */
export function Suppliers({ items, industries, catNames, onOpen }: { items: PublicSupplier[]; industries: PublicIndustry[]; catNames: (id: string) => string[]; onOpen: (s: PublicSupplier) => void }) {
  if (items.length === 0) return null;
  return (
    <Reveal className="mk-block" as="section">
      <div className="mk-wrap" id="suppliers">
        <div className="mk-head"><h2><span className="ic"><Building2 size={17} /></span><span className="sr-only">Suppliers</span></h2></div>
        <div className="mk-sups">
          {items.slice(0, 8).map(s => {
            const ind = industries.find(i => i.id === s.industry_id);
            const cats = catNames(s.id);
            return (
              <article className="mk-sup" key={s.id}>
                <span className="ic"><IconFor name={ind?.icon} size={18} /></span>
                <div>
                  <h3>{s.name}</h3>
                  <small>{ind?.name}{s.location && <> · <MapPin size={12} /> {s.location}</>}</small>
                  {cats.length > 0 && <p className="tags">{cats.slice(0, 3).map(n => <span key={n}>{n}</span>)}{cats.length > 3 && <span>+{cats.length - 3}</span>}</p>}
                </div>
                <button className="go" aria-label={`View ${s.name}`} title="View Business" onClick={() => onOpen(s)}><ArrowRight size={16} /></button>
              </article>
            );
          })}
        </div>
      </div>
    </Reveal>
  );
}

export function SupplierDialog({ s, industries, cats, onClose }: { s: PublicSupplier; industries: PublicIndustry[]; cats: string[]; onClose: () => void }) {
  useLock(true, onClose);
  const ind = industries.find(i => i.id === s.industry_id);
  return (
    <div className="mk-layer" role="dialog" aria-modal="true" aria-label={s.name}>
      <button className="mk-scrim" aria-label="Close" onClick={onClose} />
      <div className="mk-dialog mk-sdlg">
        <button className="mk-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="mk-dbody">
          <span className="ic big"><IconFor name={ind?.icon} size={24} /></span>
          <small className="mk-cat">{ind?.name}</small>
          <h3>{s.name}</h3>
          {s.location && <p className="mk-brand"><MapPin size={13} /> {s.location}</p>}
          {s.about && <p className="mk-desc">{s.about}</p>}
          {cats.length > 0 && <p className="tags">{cats.map(n => <span key={n}>{n}</span>)}</p>}
          <ContactIcons message={`Hello TradeLink, I would like to connect with ${s.name}.`} />
        </div>
      </div>
    </div>
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
        <div className="mk-head"><h2 style={tone("Popular")}><span className="ic">{ranked.hasBest ? <Flame size={17} /> : <Sparkles size={17} />}</span><span className="sr-only">{ranked.hasBest ? "Popular products" : "Latest products"}</span></h2></div>
        {chips.length > 1 && (
          <div className="mk-chips" role="group" aria-label="Filter by industry">
            <button className={active === "all" ? "on" : ""} aria-pressed={active === "all"} onClick={() => { setChip("all"); setMore(1); }}>All</button>
            {chips.map(i => <button key={i.id} className={active === i.id ? "on" : ""} aria-pressed={active === i.id} onClick={() => { setChip(i.id); setMore(1); }}><IconFor name={i.icon} size={14} />{i.name}</button>)}
          </div>
        )}
        <div className="mk-grid" key={active}>{shown.map(p => <MiniCard key={p.id} p={p} shelf={shelf} />)}</div>
        {shown.length < list.length && <div className="mk-more"><button aria-label="Show more" title="Show more" onClick={() => setMore(m => m + 1)}><Plus size={18} /></button></div>}
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
            {shelf.mode === "business" && <span title={`Minimum order ${Number(p.min_order_quantity)} ${p.unit}`}><Layers size={14} />{Number(p.min_order_quantity)}</span>}
          </div>
          <div className="mk-dact">
            {fashion
              ? <button className="mk-primary" aria-label="Open in store" title="Open in store" onClick={() => onStore(p)}><Store size={20} /><ArrowRight size={18} /></button>
              : <button className="mk-primary" aria-label={added ? "Added to request" : "Add to request"} title={added ? "Added" : "Add to request"} onClick={() => { shelf.addToRequest(p); if (!added) onClose(); }}>{added ? <Check size={20} /> : <><Plus size={20} /><ClipboardList size={20} /></>}</button>}
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
        <header><h2><Heart size={18} /><span className="sr-only">Wishlist</span>{items.length > 0 && <b className="cnt">{items.length}</b>}</h2><button className="mk-x" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
        {items.length === 0
          ? <div className="mk-empty" role="img" aria-label="No saved products yet"><Heart size={34} /></div>
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

/* ------------------------------------------------------------- how it works */

export function Steps() {
  const items = [
    { Icon: Search, t: "Find" },
    { Icon: ClipboardList, t: "Request" },
    { Icon: MessageCircle, t: "Order" },
  ];
  return (
    <Reveal className="mk-block" as="section">
      <div className="mk-wrap">
        <ol className="mk-steps" aria-label="How it works: find a product, request a price, order by chat">
          {items.map(({ Icon, t }, k) => (
            <li key={t} style={{ "--k": k } as CSSProperties}>
              <span className="bub"><Icon size={22} /></span><b>{t}</b>
              {k < items.length - 1 && <i className="line" aria-hidden="true" />}
            </li>
          ))}
        </ol>
      </div>
    </Reveal>
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
          <ContactIcons />
        </div>
        {industries.length > 0 && (
          <nav aria-label="Industries"><h4 title="Industries"><Layers size={18} /></h4>
            <ul>{industries.slice(0, 8).map(i => <li key={i.id}><button onClick={() => onIndustry(i)}>{i.name}</button></li>)}</ul>
          </nav>
        )}
        <nav aria-label="Support" className="mk-fico"><h4 title="Support"><Headphones size={18} /></h4>
          <button aria-label="Request a price" title="Request a price" onClick={onRequest}><ClipboardList size={19} /></button>
          <a href="#public-products" aria-label="Shop" title="Shop" onClick={e => { e.preventDefault(); document.getElementById("public-products")?.scrollIntoView({ behavior: "smooth" }); }}><Store size={19} /></a>
          <button aria-label={signedIn ? "Admin" : "Staff sign in"} title={signedIn ? "Admin" : "Staff sign in"} onClick={onAccount}><LogIn size={19} /></button>
        </nav>
      </div>
      <div className="mk-wrap mk-copy"><small>© {new Date().getFullYear()} TradeLink</small></div>
    </footer>
  );
}

