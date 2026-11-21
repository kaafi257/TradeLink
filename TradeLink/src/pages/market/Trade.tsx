import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowRight, Briefcase, Building2, Check, ChevronDown, ChevronRight, ClipboardList, Clock, Flame, Grid3x3, Headphones, Heart, Home, LogIn, MapPin, Menu, MessageCircle, Package, Percent, Search, ShoppingBag, ShieldCheck, Sparkles, Star, Store, Tag, Truck, User, X } from "lucide-react";
import { Brand } from "../../components/Brand";
import { ContactIcons } from "../../components/ContactActions";
import { useContact } from "../../lib/contact";
import { applyCoupon } from "../../lib/coupon";
import { IconFor } from "../../lib/icons";
import { lookFor } from "../../lib/theme";
import { THEMES, useTheme } from "../../lib/siteTheme";
import { supabase, type PublicCategory, type PublicIndustry, type PublicProduct, type PublicSupplier } from "../../lib/supabase";
import { CleanCard, Reveal, type Mode, type Shelf } from "./Market";
import "./trade.css";

const tone = (name: string) => { const l = lookFor(name); return { "--ta": l.a, "--tt": l.tint, "--ti": l.ink } as CSSProperties; };
const nav = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/* ---------------------------------------------------------- announcement bar */

/** Only facts we really have: catalogue size and the contact details saved in Admin. */
/** Website colour theme: Comfort (default), Calm or Light. Remembered on this device. */
function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="tl-theme" role="group" aria-label="Page colour">
      {THEMES.map(t => (
        <button key={t.id} type="button" className={theme === t.id ? "on" : ""} aria-pressed={theme === t.id} aria-label={t.label} title={t.label} onClick={() => setTheme(t.id)} style={{ background: t.swatch }} />
      ))}
    </div>
  );
}

export function AnnouncementBar({ products }: { products: number; industries: number }) {
  const c = useContact();
  // Live banners written in Admin → Website Management. If none (or the table is not set up yet) the usual line is shown.
  const [banners, setBanners] = useState<{ id: string; message: string; link: string | null }[]>([]);
  useEffect(() => {
    if (!supabase) return;
    void supabase.rpc("sync_promotions").then(() => undefined, () => undefined);   // starts or ends scheduled promotions that are due
    void supabase.from("site_banners").select("id, message, link").order("sort_order").order("created_at", { ascending: false }).limit(3)
      .then(({ data, error }) => { if (!error && data) setBanners(data); });
  }, []);
  return (
    <div className="tl-ann" role="region" aria-label="Marketplace information">
      <div className="tl-wrap">
        {banners.map(b => b.link
          ? <a key={b.id} href={b.link} style={{ color: "inherit", fontWeight: 700 }}>{b.message}</a>
          : <span key={b.id} style={{ fontWeight: 700 }}>{b.message}</span>)}
        {banners.length === 0 && <span>Wholesale and retail, one marketplace{products > 0 ? ` · ${products} products` : ""}</span>}
        {c.phone && <a className="hide-s" href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</a>}
        <ThemeSwitch />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- header */

type Hit =
  | { kind: "product"; p: PublicProduct; label: string; sub: string }
  | { kind: "industry"; i: PublicIndustry; label: string; sub: string }
  | { kind: "category"; c: PublicCategory; label: string; sub: string }
  | { kind: "supplier"; s: PublicSupplier; label: string; sub: string };

/* Compact animated replacement for the native <select> (the OS picker is huge on phones). */
function ScopeMenu({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const all = [{ id: "all", name: "All" }, ...items];
  const cur = all.find(i => i.id === value) ?? all[0];
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down); document.addEventListener("touchstart", down); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("touchstart", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return (
    <div className={`tl-scope${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="tl-scope-btn" aria-haspopup="listbox" aria-expanded={open} aria-label="Search in" onClick={() => setOpen(o => !o)}>
        <span>{cur.name}</span><ChevronDown size={14} />
      </button>
      <ul className="tl-scope-menu" role="listbox" aria-hidden={!open}>
        {all.map(i => (
          <li key={i.id} role="option" aria-selected={i.id === value}>
            <button type="button" tabIndex={open ? 0 : -1} className={i.id === value ? "on" : ""} onClick={() => { onChange(i.id); setOpen(false); }}>
              <span>{i.name}</span>{i.id === value && <Check size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TradeHeader({ shelf, suppliers, wishCount, requestCount, signedIn, onWishlist, onRequest, onAccount, onSearch, onPickIndustry, onPickCategory, onSupplier, searchRef, openMenu, menuOpen }: {
  shelf: Shelf; suppliers: PublicSupplier[]; wishCount: number; requestCount: number; signedIn: boolean;
  onWishlist: () => void; onRequest: () => void; onAccount: () => void;
  onSearch: (q: string, industryId: string) => void; onPickIndustry: (i: PublicIndustry) => void; onPickCategory: (c: PublicCategory) => void; onSupplier: (s: PublicSupplier) => void;
  searchRef: React.RefObject<HTMLInputElement>; openMenu: () => void; menuOpen: boolean;
}) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState("all");
  const [focus, setFocus] = useState(false);
  const [solid, setSolid] = useState(false);
  useEffect(() => { const f = () => setSolid(window.scrollY > 40); f(); window.addEventListener("scroll", f, { passive: true }); return () => window.removeEventListener("scroll", f); }, []);
  const t = q.trim().toLowerCase();
  const hits = useMemo<Hit[]>(() => {
    if (t.length < 2) return [];
    const out: Hit[] = [];
    for (const i of shelf.industries) if (i.name.toLowerCase().includes(t)) out.push({ kind: "industry", i, label: i.name, sub: "Industry" });
    for (const c of shelf.categories) if (c.name.toLowerCase().includes(t)) out.push({ kind: "category", c, label: c.name, sub: "Category" });
    for (const s of suppliers) if (s.name.toLowerCase().includes(t)) out.push({ kind: "supplier", s, label: s.name, sub: s.location ? `Supplier · ${s.location}` : "Supplier" });
    const inScope = (p: PublicProduct) => scope === "all" || shelf.indOf(p)?.id === scope;
    for (const p of shelf.products.filter(p => inScope(p) && `${p.name} ${p.brand ?? ""} ${p.category}`.toLowerCase().includes(t)).slice(0, 5)) out.push({ kind: "product", p, label: p.name, sub: [p.brand, shelf.catName(p)].filter(Boolean).join(" · ") });
    return out.slice(0, 9);
  }, [t, shelf, suppliers, scope]);
  const pick = (h: Hit) => {
    setFocus(false);
    if (h.kind === "product") shelf.open(h.p); else if (h.kind === "industry") onPickIndustry(h.i);
    else if (h.kind === "category") onPickCategory(h.c); else onSupplier(h.s);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); setFocus(false); onSearch(q, scope); };
  return (
    <header className={`tl-head${solid ? " solid" : ""}`}>
      <div className="tl-wrap tl-head-in">
        <a href="#top" className="tl-logo" aria-label="TradeLink home" onClick={e => { e.preventDefault(); nav("top"); }}><Brand /></a>
        <div className="tl-search">
          <form role="search" onSubmit={submit}>
            <ScopeMenu value={scope} onChange={setScope} items={shelf.industries.map(i => ({ id: i.id, name: i.name }))} />
            <input ref={searchRef} type="search" value={q} onChange={e => { setQ(e.target.value); setFocus(true); }} onFocus={() => setFocus(true)} onBlur={() => window.setTimeout(() => setFocus(false), 150)}
              placeholder="Search products" aria-label="Search" autoComplete="off" />
            {q && <button type="button" className="clr" aria-label="Clear" onClick={() => { setQ(""); searchRef.current?.focus(); }}><X size={15} /></button>}
            <button className="go" aria-label="Search"><Search size={18} /></button>
          </form>
          {focus && t.length >= 2 && (
            <ul className="tl-suggest" role="listbox">
              {hits.length === 0 && <li className="none"><Search size={16} />No matches for “{q.trim()}”. Try a shorter word or pick another industry.</li>}
              {hits.map((h, k) => (
                <li key={k}><button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(h)}>
                  <span className="ic">{h.kind === "industry" ? <IconFor name={h.i.icon} size={16} /> : h.kind === "supplier" ? <Building2 size={16} /> : h.kind === "category" ? <Grid3x3 size={16} /> : <Package size={16} />}</span>
                  <span className="tx"><b>{h.label}</b><small>{h.sub}</small></span><ChevronRight size={15} />
                </button></li>
              ))}
            </ul>
          )}
        </div>
        <div className="tl-acts">
          <button className="tl-act" onClick={onWishlist} title="Wishlist" aria-label="Wishlist"><Heart size={20} />{wishCount > 0 && <i key={wishCount}>{wishCount}</i>}</button>
          <button className="tl-act" onClick={onRequest} title="Price request" aria-label={`Price request, ${requestCount} ${requestCount === 1 ? "product" : "products"}`}><ShoppingBag size={20} />{requestCount > 0 && <i key={requestCount}>{requestCount}</i>}</button>
          <button className="tl-act" onClick={onAccount} title={signedIn ? "Admin" : "Sign in"} aria-label={signedIn ? "Admin" : "Sign in"}><User size={20} /></button>
          <button className="tl-act tl-burger" onClick={openMenu} aria-label="Categories" aria-expanded={menuOpen}><Menu size={22} /></button>
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------- secondary navigation */

export function ModeToggle({ mode, onMode, className = "" }: { mode: Mode; onMode: (m: Mode) => void; className?: string }) {
  return (
    <div className={`tl-buy ${mode} ${className}`} role="group" aria-label="I am buying as">
      <i className="thumb" aria-hidden="true" />
      <button aria-pressed={mode === "individual"} onClick={() => onMode("individual")}>Retail</button>
      <button aria-pressed={mode === "business"} onClick={() => onMode("business")}>Wholesale</button>
    </div>
  );
}

export function TradeNav({ mode, industries, categories, counts, onMode, onPickIndustry, onPickCategory, open, setOpen, onRfq }: {
  mode: Mode; industries: PublicIndustry[]; categories: PublicCategory[]; counts: Map<string, number>;
  onMode: (m: Mode) => void; onPickIndustry: (i: PublicIndustry) => void; onPickCategory: (c: PublicCategory) => void; open: boolean; setOpen: (v: boolean) => void; onRfq: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open, setOpen]);
  const go = (m: Mode | null, id: string) => { if (m) onMode(m); setOpen(false); window.setTimeout(() => nav(id), 60); };
  return (
    <nav className="tl-nav" aria-label="Marketplace" ref={ref}>
      <div className="tl-wrap tl-nav-in">
        <button className={`tl-allcat${open ? " on" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}><Menu size={17} /><b>Categories</b></button>
        <div className="tl-links">
          <button onClick={() => go("business", "wholesale")}>Wholesale</button>
          <button onClick={() => go(null, "suppliers")}>Suppliers</button>
          <button onClick={() => go(null, "new-arrivals")}>New</button>
          <button className="rfq" onClick={onRfq}>Get a quote</button>
        </div>
        <ModeToggle mode={mode} onMode={onMode} />
      </div>
      {open && (
        <div className="tl-mega" role="menu">
          <div className="tl-wrap tl-mega-in">
            {industries.map(i => {
              const cs = categories.filter(c => c.industry_id === i.id && (counts.get(c.id) ?? 0) > 0);
              return (
                <div className="col" key={i.id} style={tone(i.name)}>
                  <button className="h" onClick={() => { setOpen(false); onPickIndustry(i); }}><span className="ic"><IconFor name={i.icon} size={17} /></span><b>{i.name}</b></button>
                  {cs.map(c => <button key={c.id} onClick={() => { setOpen(false); onPickCategory(c); }}>{c.name}<em>{counts.get(c.id)}</em></button>)}
                  {cs.length === 0 && <small>Coming soon</small>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}

/* ---------------------------------------------------------------------- hero */

type Slide = { ind: PublicIndustry; img: string | null; count: number };

export function TradeHero({ shelf, slides, counts, onPickIndustry, onPickCategory }: {
  shelf: Shelf; slides: Slide[]; counts: Map<string, number>;
  onPickIndustry: (i: PublicIndustry) => void; onPickCategory: (c: PublicCategory) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [hold, setHold] = useState(false);
  const len = slides.length;
  useEffect(() => {
    if (len < 2 || hold || (typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
    const t = window.setInterval(() => setN(v => (v + 1) % len), 5200);
    return () => window.clearInterval(t);
  }, [len, hold]);
  const cur = slides[Math.min(n, Math.max(0, len - 1))];
  const hov = shelf.industries.find(i => i.id === hover);
  const indCount = (id: string) => shelf.categories.filter(c => c.industry_id === id).reduce((n, c) => n + (counts.get(c.id) ?? 0), 0);
  const hovCats = hov ? shelf.categories.filter(c => c.industry_id === hov.id && (counts.get(c.id) ?? 0) > 0) : [];
  return (
    <section className="tl-hero" id="top">
      <div className="tl-wrap tl-hero-in">
        <aside className="tl-side" aria-label="Categories" onMouseLeave={() => setHover(null)}>
          <h2>Categories</h2>
          <ul>
            {shelf.industries.map(i => (
              <li key={i.id} style={tone(i.name)} className={hover === i.id ? "on" : ""} onMouseEnter={() => setHover(i.id)}>
                <button onClick={() => onPickIndustry(i)} onFocus={() => setHover(i.id)}>
                  <span className="ic"><IconFor name={i.icon} size={16} /></span><b>{i.name}</b>
                  {indCount(i.id) > 0 && <small>{indCount(i.id)}</small>}<ChevronRight size={14} />
                </button>
              </li>
            ))}
          </ul>
          {hov && hovCats.length > 0 && (
            <div className="tl-fly" style={tone(hov.name)}>
              <h3>{hov.name}</h3>
              <div>{hovCats.map(cc => <button key={cc.id} onClick={() => onPickCategory(cc)}>{cc.name}<em>{counts.get(cc.id)}</em></button>)}</div>
            </div>
          )}
        </aside>

        <div className="tl-banner" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} aria-roledescription="carousel">
          {slides.length === 0 && <div className="tl-slide on empty"><div className="tx"><h1>Wholesale and retail marketplace</h1><p>Products are being added. Please check back soon.</p></div></div>}
          {slides.map((s, k) => (
            <div key={s.ind.id} className={`tl-slide${k === n ? " on" : ""}`} style={tone(s.ind.name)} aria-hidden={k !== n}>
              {s.img ? <img src={s.img} alt="" loading={k === 0 ? "eager" : "lazy"} /> : <span className="wm"><IconFor name={s.ind.icon} size={220} /></span>}
              <div className="tx">
                {k === 0 ? <h1>{s.ind.name}</h1> : <h2>{s.ind.name}</h2>}
                <button tabIndex={k === n ? 0 : -1} onClick={() => onPickIndustry(s.ind)}>Shop now<ArrowRight size={16} /></button>
              </div>
            </div>
          ))}
          {len > 1 && (
            <div className="dots" role="tablist" aria-label="Banners">
              {slides.map((s, k) => <button key={s.ind.id} role="tab" aria-selected={k === n} aria-label={s.ind.name} className={k === n ? "on" : ""} onClick={() => setN(k)}><i key={k === n ? `on${n}` : "off"} className={hold ? "held" : ""} /></button>)}
            </div>
          )}
          {cur && len > 1 && <><button className="arr l" aria-label="Previous banner" onClick={() => setN((n - 1 + len) % len)}><ChevronRight size={20} style={{ transform: "scaleX(-1)" }} /></button><button className="arr r" aria-label="Next banner" onClick={() => setN((n + 1) % len)}><ChevronRight size={20} /></button></>}
        </div>

      </div>
    </section>
  );
}

/* ------------------------------------------------------------ product rows */

export function TradeRow({ id, title, sub, shelf, items, mode, onAll, max = 6 }: {
  id: string; title: string; sub?: string; shelf: Shelf; items: PublicProduct[]; mode?: Mode; onAll?: () => void; max?: number;
}) {
  if (items.length === 0) return null;
  return (
    <Reveal className="tl-sec" as="section">
      <div className="tl-wrap" id={id}>
        <div className="tl-sh"><div><h2>{title}</h2>{sub && <small>{sub}</small>}</div>{onAll && <button onClick={onAll}>View all<ArrowRight size={15} /></button>}</div>
        <div className="tl-prods">{[...new Map(items.map(p => [p.id, p])).values()].slice(0, max).map(p => <CleanCard key={p.id} p={p} shelf={shelf} mode={mode} />)}</div>
      </div>
    </Reveal>
  );
}

/** Featured suppliers from the admin-managed directory. */
export function SupplierStrip({ items, industries, onOpen, starred }: { items: PublicSupplier[]; industries: PublicIndustry[]; onOpen: (s: PublicSupplier) => void; starred?: Set<string> }) {
  if (items.length === 0) return null;
  items = [...items].sort((a, b) => Number(starred?.has(b.id) ?? false) - Number(starred?.has(a.id) ?? false));
  const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("");
  return (
    <Reveal className="tl-sec" as="section">
      <div className="tl-wrap" id="suppliers">
        <div className="tl-sh"><div><h2>Featured suppliers</h2></div></div>
        <div className="tl-sups">
          {items.slice(0, 6).map(sp => (
            <button key={sp.id} onClick={() => onOpen(sp)}>
              <span className="lg">{initials(sp.name)}</span>
              <span className="tx"><b>{sp.name}</b><small>{[industries.find(i => i.id === sp.industry_id)?.name, sp.location].filter(Boolean).join(" · ")}</small></span>
              {starred?.has(sp.id) ? <span className="star" title="Featured"><Star size={15} fill="currentColor" /></span> : <ChevronRight size={16} />}
            </button>
          ))}
        </div>
      </div>
    </Reveal>
  );
}

/** Compact sourcing banner; the full form opens in a dialog. */
export function RfqBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="tl-sec"><div className="tl-wrap">
      <div className="tl-rfqbar">
        <span className="ic"><ClipboardList size={24} /></span>
        <div><h2>Looking for products in bulk?</h2><p>Send your requirements and get a price from the team.</p></div>
        <button onClick={onOpen}>Request a quote<ArrowRight size={17} /></button>
      </div>
    </div></section>
  );
}

/* ----------------------------------------------------- request for quotation */

export function RfqModal({ products, industries, categories, catOf, onClose }: {
  products: PublicProduct[]; industries: PublicIndustry[]; categories: PublicCategory[]; catOf: (p: PublicProduct) => PublicCategory | undefined; onClose: () => void;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k); const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  const [ind, setInd] = useState("all");
  const [pid, setPid] = useState("");
  const [qty, setQty] = useState("");
  const [f, setF] = useState({ name: "", phone: "", email: "", location: "", notes: "", website: "" });
  const [coupon, setCoupon] = useState("");
  const [couponMsg, setCouponMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const list = products.filter(p => ind === "all" || catOf(p)?.industry_id === ind);
  const prod = products.find(p => p.id === pid);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(v => ({ ...v, [k]: e.target.value }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supabase) { setErr("The catalogue is not connected yet."); return; }
    if (!prod) { setErr("Choose the product you need."); return; }
    const n = Number(qty);
    if (!(n > 0)) { setErr("Enter the quantity you need."); return; }
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("submit_request", {
      p_name: f.name, p_phone: f.phone, p_email: f.email, p_location: f.location, p_items: [{ product_id: prod.id, quantity: n }],
      p_notes: f.notes || null, p_website: f.website, p_customer_type: "business",
    });
    if (!error) setCouponMsg(await applyCoupon(String(data ?? ""), f.phone, coupon));
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDone(String(data ?? "") || "QTN-RECEIVED");
  };
  return (
    <div className="tl-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tl-dialog" role="dialog" aria-modal="true" aria-label="Request a quote">
        <button className="x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="tl-rfq">
          <div className="lead">
            <span className="ic"><ClipboardList size={26} /></span>
            <h2>Request for quotation</h2>
            <p>Tell us what you need and how much. We reply with a price.</p>
            <ul><li><Package size={16} />Pick a product</li><li><Tag size={16} />Enter quantity and details</li><li><Check size={16} />Get a price from the team</li></ul>
          </div>
          {done ? (
            <div className="done"><Check size={44} /><h3>Request received</h3><p>Your reference is <b>{done}</b>. The TradeLink team will contact you shortly.</p>{couponMsg && <p role="status"><b>{couponMsg}</b></p>}<button onClick={() => { setDone(""); setPid(""); setQty(""); setCoupon(""); setCouponMsg(""); setF({ name: "", phone: "", email: "", location: "", notes: "", website: "" }); }}>New request</button></div>
          ) : (
            <form onSubmit={submit}>
              <div className="g2">
                <label>Category<select value={ind} onChange={e => { setInd(e.target.value); setPid(""); }}><option value="all">All</option>{industries.filter(i => categories.some(c => c.industry_id === i.id)).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
                <label>Product<select value={pid} onChange={e => { setPid(e.target.value); const p = products.find(x => x.id === e.target.value); if (p && !qty) setQty(String(Number(p.min_order_quantity) || 1)); }} required><option value="">Choose…</option>{list.map(p => <option key={p.id} value={p.id}>{p.name}{p.package_size ? ` — ${p.package_size}` : ""}</option>)}</select></label>
              </div>
              <div className="g2">
                <label>Quantity{prod ? ` (${prod.unit})` : ""}<input inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ""))} placeholder={prod ? `Minimum ${Number(prod.min_order_quantity)}` : "e.g. 100"} required /></label>
                <label>Delivery location<span className="pin"><MapPin size={15} /><input value={f.location} onChange={set("location")} placeholder="City or area" required /></span></label>
              </div>
              <label>Specifications<textarea rows={2} value={f.notes} onChange={set("notes")} placeholder="Brand, size, packaging or anything else we should know" maxLength={1000} /></label>
              <label>Coupon code (optional)<input value={coupon} onChange={e => setCoupon(e.target.value)} maxLength={20} autoComplete="off" placeholder="e.g. WELCOME10" /></label>
              <div className="g3">
                <label>Name or business<input value={f.name} onChange={set("name")} required autoComplete="name" /></label>
                <label>Phone<input type="tel" value={f.phone} onChange={set("phone")} required autoComplete="tel" /></label>
                <label>Email<input type="email" value={f.email} onChange={set("email")} placeholder="Optional" autoComplete="email" /></label>
              </div>
              <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set("website")} />
              {err && <p className="err" role="alert">{err}</p>}
              <button className="send" disabled={busy}>{busy ? "Sending…" : <>Submit request<ArrowRight size={17} /></>}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- mobile bottom bar */

export function BottomNav({ wishCount, requestCount, onHome, onCategories, onSearch, onWishlist, onRequest }: {
  wishCount: number; requestCount: number; onHome: () => void; onCategories: () => void; onSearch: () => void; onWishlist: () => void; onRequest: () => void;
}) {
  return (
    <nav className="tl-bottom" aria-label="Quick navigation">
      <button onClick={onHome}><Home size={21} /><span>Home</span></button>
      <button onClick={onCategories}><Grid3x3 size={21} /><span>Categories</span></button>
      <button onClick={onSearch}><Search size={21} /><span>Search</span></button>
      <button onClick={onWishlist}><Heart size={21} />{wishCount > 0 && <i>{wishCount}</i>}<span>Wishlist</span></button>
      <button onClick={onRequest}><ShoppingBag size={21} />{requestCount > 0 && <i>{requestCount}</i>}<span>Request</span></button>
    </nav>
  );
}

