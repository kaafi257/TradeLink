import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Building2, Check, ChevronDown, Download, Heart, MapPin, Menu, Plus, Search, ShoppingBag, User, UserRound, X } from "lucide-react";
import { Brand } from "../../components/Brand";
import { ContactIcons, ContactPills, ContactRow, FloatingContact } from "../../components/ContactActions";
import { money } from "../../lib/format";
import { IconFor } from "../../lib/icons";
import { useInstall } from "../../lib/install";
import { supabase, type PublicCategory, type PublicIndustry, type PublicProduct, type PublicSupplier } from "../../lib/supabase";
import { MODE_KEY, RequestModal, allows, catKey, defaultQty, newKey, readMode, type Line, type Mode } from "../RequestModal";
import "./market.css";

const WISH_KEY = "tradelink-wishlist"; // shared with the Clothing storefront
const readWish = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(WISH_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
};
const delay = (i: number) => ({ "--i": i } as CSSProperties);
const PAGE = 8;

type Status = "loading" | "ready" | "error" | "offline";
type Supplier = PublicSupplier;
type Data = {
  status: Status; products: PublicProduct[]; industries: PublicIndustry[]; categories: PublicCategory[];
  suppliers: Supplier[]; supCats: { supplier_id: string; category_id: string }[]; bestIds: string[];
};

function useMarketData(): Data {
  const [d, setD] = useState<Data>({ status: supabase ? "loading" : "offline", products: [], industries: [], categories: [], suppliers: [], supCats: [], bestIds: [] });
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    (async () => {
      const [p, i, c] = await Promise.all([
        supabase.from("public_products").select("*").order("name"),
        supabase.from("public_industries").select("*").order("sort_order").order("name"),
        supabase.from("public_categories").select("*").order("sort_order").order("name"),
      ]);
      if (!live) return;
      if (p.error) { setD(s => ({ ...s, status: "error" })); return; }
      setD(s => ({ ...s, status: "ready", products: (p.data ?? []) as PublicProduct[], industries: i.error ? [] : ((i.data ?? []) as PublicIndustry[]), categories: c.error ? [] : ((c.data ?? []) as PublicCategory[]) }));
      // Suppliers (migration 0007) and best sellers (0006) are optional: if a view is missing, that part is simply hidden.
      const [s, sc, b] = await Promise.all([
        supabase.from("public_suppliers").select("*").order("name"),
        supabase.from("public_supplier_categories").select("*"),
        supabase.from("public_best_sellers").select("*").order("rank"),
      ]);
      if (!live) return;
      setD(x => ({
        ...x,
        suppliers: s.error ? [] : ((s.data ?? []) as Supplier[]),
        supCats: sc.error ? [] : ((sc.data ?? []) as { supplier_id: string; category_id: string }[]),
        bestIds: b.error ? [] : ((b.data ?? []) as { product_id: string }[]).map(r => r.product_id),
      }));
    })();
    return () => { live = false; };
  }, []);
  return d;
}

/** Fades sections in as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(".mk [data-rv]:not([data-in])");
    if (!("IntersectionObserver" in window)) { els.forEach(e => e.setAttribute("data-in", "")); return undefined; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.setAttribute("data-in", ""); io.unobserve(e.target); } }), { rootMargin: "0px 0px -5% 0px" });
    els.forEach(e => io.observe(e));
    return () => { io.disconnect(); };
  });
}

/** Escape closes, and the page behind does not scroll. */
function useDialog(onClose: () => void) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", key); };
  }, [onClose]);
}

type Ctx = {
  mode: Mode; wished: Set<string>; toggleWish: (id: string) => void; inCart: (id: string) => boolean; add: (p: PublicProduct) => void;
  open: (p: PublicProduct) => void; catName: (p: PublicProduct) => string; industryOf: (p: PublicProduct) => PublicIndustry | undefined; photo: (p: PublicProduct) => string | null;
};

function priceOf(p: PublicProduct, mode: Mode) {
  const retail = mode === "individual" && Number(p.retail_price) > 0 ? Number(p.retail_price) : null;
  const sale = retail !== null && p.sale_price && Number(p.sale_price) > 0 && Number(p.sale_price) < retail ? Number(p.sale_price) : null;
  return { now: sale ?? retail, was: sale !== null ? retail : null };
}
const STOCK = { in: "In stock", low: "Low stock", out: "Out of stock" } as const;
const productHref = (p: PublicProduct, ind?: PublicIndustry) => (ind?.storefront === "fashion" ? `/clothing/${p.id}` : null);

function ProductCard({ p, c, i = 0 }: { p: PublicProduct; c: Ctx; i?: number }) {
  const { now, was } = priceOf(p, c.mode);
  const img = c.photo(p);
  const wished = c.wished.has(p.id);
  const added = c.inCart(p.id);
  const ind = c.industryOf(p);
  return (
    <article className={`mk-card${p.stock_status === "out" ? " out" : ""}`} data-rv="" style={delay(i % 4)}>
      <button className="mk-img" onClick={() => c.open(p)} aria-label={`View ${p.name}`}>
        {img ? <img src={img} alt="" loading="lazy" decoding="async" /> : <span className="mk-ph"><IconFor name={ind?.icon} size={30} /></span>}
        {was !== null && <span className="mk-badge">Sale</span>}
      </button>
      <button className={`mk-heart${wished ? " on" : ""}`} aria-pressed={wished} aria-label={wished ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`} onClick={() => c.toggleWish(p.id)}>
        <Heart size={16} fill={wished ? "currentColor" : "none"} />
      </button>
      <div className="mk-info">
        <small>{p.brand || c.catName(p)}</small>
        <h3><button onClick={() => c.open(p)}>{p.name}</button></h3>
        {p.stock_status && <em className={`mk-stock s-${p.stock_status}`}>{STOCK[p.stock_status]}</em>}
        <div className="mk-row">
          <span className="mk-price">
            {now !== null ? <><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}</> : <span className="mk-ask">Price on request</span>}
          </span>
          <button className={`mk-add${added ? " on" : ""}`} aria-label={added ? `${p.name} is in your request` : `Add ${p.name} to your request`} title={added ? "In your request" : "Add to request"} onClick={() => c.add(p)}>
            {added ? <Check size={16} /> : <Plus size={16} />}
          </button>
        </div>
      </div>
    </article>
  );
}

function Details({ p, c, onClose }: { p: PublicProduct; c: Ctx; onClose: () => void }) {
  useDialog(onClose);
  const { now, was } = priceOf(p, c.mode);
  const ind = c.industryOf(p);
  const img = c.photo(p);
  const href = productHref(p, ind);
  const added = c.inCart(p.id);
  const wished = c.wished.has(p.id);
  return (
    <div className="mk-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk-dialog" role="dialog" aria-modal="true" aria-label={p.name}>
        <button className="mk-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="mk-dlg-img">{img ? <img src={img} alt={p.name} /> : <span className="mk-ph"><IconFor name={ind?.icon} size={44} /></span>}</div>
        <div className="mk-dlg-body">
          <small className="mk-eyebrow">{ind && <><IconFor name={ind.icon} size={13} /> {ind.name} · </>}{c.catName(p)}</small>
          <h2>{p.name}</h2>
          {p.brand && <p className="mk-muted">{p.brand}</p>}
          <div className="mk-dlg-price">
            {now !== null ? <><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}<small>per {p.unit}</small></> : <span className="mk-ask">Price on request</span>}
          </div>
          <ul className="mk-facts">
            {p.stock_status && <li><span>Availability</span><b className={`s-${p.stock_status}`}>{STOCK[p.stock_status]}</b></li>}
            {p.package_size && <li><span>Pack</span><b>{p.package_size}</b></li>}
            {c.mode === "business" && Number(p.min_order_quantity) > 1 && <li><span>Minimum order</span><b>{p.min_order_quantity} {p.unit}</b></li>}
          </ul>
          {p.description && <p className="mk-desc">{p.description}</p>}
          <div className="mk-dlg-actions">
            <button className="mk-btn dark" onClick={() => { c.add(p); onClose(); }}>{added ? "View my request" : "Add to request"} <ArrowRight size={16} /></button>
            <button className={`mk-btn line${wished ? " on" : ""}`} aria-pressed={wished} onClick={() => c.toggleWish(p.id)}><Heart size={16} fill={wished ? "currentColor" : "none"} /> {wished ? "Saved" : "Save"}</button>
          </div>
          {href && <Link className="mk-link" to={href}>Open in the {ind?.name} store <ArrowRight size={14} /></Link>}
          <ContactPills message={`Hello TradeLink, I would like ${c.mode === "individual" ? "a price" : "a wholesale price"} for ${p.name}.`} />
        </div>
      </div>
    </div>
  );
}

function SupplierCard({ s, ind, cats, onOpen, i = 0 }: { s: Supplier; ind?: PublicIndustry; cats: string[]; onOpen: () => void; i?: number }) {
  return (
    <article className="mk-sup" data-rv="" style={delay(i % 4)}>
      <span className="mk-sup-ico"><IconFor name={ind?.icon} size={20} /></span>
      <div>
        <h3>{s.name}</h3>
        <small>{ind?.name}{s.location && <> · <MapPin size={12} /> {s.location}</>}</small>
        {cats.length > 0 && <p className="mk-tags">{cats.slice(0, 3).map(n => <span key={n}>{n}</span>)}{cats.length > 3 && <span>+{cats.length - 3}</span>}</p>}
      </div>
      <button className="mk-btn line sm" onClick={onOpen}>View Business</button>
    </article>
  );
}

function SupplierDialog({ s, ind, cats, onClose }: { s: Supplier; ind?: PublicIndustry; cats: string[]; onClose: () => void }) {
  useDialog(onClose);
  return (
    <div className="mk-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mk-dialog narrow" role="dialog" aria-modal="true" aria-label={s.name}>
        <button className="mk-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="mk-dlg-body">
          <span className="mk-sup-ico big"><IconFor name={ind?.icon} size={26} /></span>
          <small className="mk-eyebrow">{ind?.name}</small>
          <h2>{s.name}</h2>
          {s.location && <p className="mk-muted"><MapPin size={14} /> {s.location}</p>}
          {s.about && <p className="mk-desc">{s.about}</p>}
          {cats.length > 0 && <p className="mk-tags">{cats.map(n => <span key={n}>{n}</span>)}</p>}
          <p className="mk-muted">Contact TradeLink and we will connect you with this business.</p>
          <ContactIcons message={`Hello TradeLink, I would like to connect with ${s.name}.`} />
        </div>
      </div>
    </div>
  );
}

function ModeSwitch({ mode, onMode, big = false }: { mode: Mode; onMode: (m: Mode) => void; big?: boolean }) {
  const opts = [
    { m: "individual" as Mode, Icon: User, label: "Individual", sub: "Personal shopping" },
    { m: "business" as Mode, Icon: Building2, label: "Business", sub: "Wholesale and suppliers" },
  ];
  return (
    <div className={`mk-mode${big ? " big" : ""}`} role="group" aria-label="I am buying as">
      {opts.map(({ m, Icon, label, sub }) => (
        <button key={m} className={mode === m ? "on" : ""} aria-pressed={mode === m} onClick={() => onMode(m)}>
          <span className="mk-mode-ico"><Icon size={big ? 18 : 15} /></span>
          <span><b>{label}</b>{big && <small>{sub}</small>}</span>
        </button>
      ))}
    </div>
  );
}

const pick = (items: PublicProduct[], catId: (p: PublicProduct) => string, n = 4) => {
  // A few products from different categories, so each industry shows its range rather than one shelf.
  const groups = new Map<string, PublicProduct[]>();
  for (const p of items) groups.set(catId(p), [...(groups.get(catId(p)) ?? []), p]);
  const lists = [...groups.values()];
  const out: PublicProduct[] = [];
  for (let r = 0; out.length < n && lists.some(l => l.length > r); r++) for (const l of lists) if (l[r] && out.length < n) out.push(l[r]);
  return out;
};

export default function Market() {
  const navigate = useNavigate();
  const app = useInstall();
  const d = useMarketData();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [cart, setCart] = useState<Line[]>([]);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [wishIds, setWishIds] = useState<string[]>(readWish);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [detail, setDetail] = useState<PublicProduct | null>(null);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [panel, setPanel] = useState<null | "menu" | "wish" | "inds">(null);
  const [toast, setToast] = useState<{ text: string; act?: boolean } | null>(null);
  const [solid, setSolid] = useState(false);
  const heroSearch = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<number>();

  // Industries/categories; before migration 0005 (or with none set up) fall back to the category names found on the products.
  const { inds, cats } = useMemo(() => {
    if (d.industries.length && d.categories.length) return { inds: d.industries, cats: d.categories };
    const names = Array.from(new Set(d.products.map(p => p.category))).sort();
    return {
      inds: names.length ? ([{ id: "__all", name: "All Products", description: null, icon: "package", sort_order: 0 }] as PublicIndustry[]) : [],
      cats: names.map((n, i) => ({ id: `name:${n}`, industry_id: "__all", name: n, description: null, image_url: null, sort_order: i })) as PublicCategory[],
    };
  }, [d.industries, d.categories, d.products]);
  const catById = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);
  const indById = useMemo(() => new Map(inds.map(i => [i.id, i])), [inds]);
  const industryOf = useCallback((p: PublicProduct) => indById.get(catById.get(catKey(p))?.industry_id ?? ""), [catById, indById]);
  const catName = useCallback((p: PublicProduct) => (p.category_id && catById.get(p.category_id)?.name) || p.category, [catById]);
  const photo = useCallback((p: PublicProduct) => p.image_url || catById.get(catKey(p))?.image_url || null, [catById]);

  const visible = useMemo(() => d.products.filter(p => allows(p, mode)), [d.products, mode]);
  const byInd = useMemo(() => {
    const m = new Map<string, PublicProduct[]>();
    for (const p of visible) { const id = industryOf(p)?.id; if (id) m.set(id, [...(m.get(id) ?? []), p]); }
    return m;
  }, [visible, industryOf]);
  const vById = useMemo(() => new Map(visible.map(p => [p.id, p])), [visible]);
  const bestVisible = useMemo(() => d.bestIds.map(id => vById.get(id)).filter((p): p is PublicProduct => !!p), [d.bestIds, vById]);
  const ranked = useMemo(() => {
    const seen = new Set(bestVisible.map(p => p.id));
    const rest = visible.filter(p => !seen.has(p.id)).sort((a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0));
    return [...bestVisible, ...rest];
  }, [visible, bestVisible]);
  const effFilter = filter === "all" || byInd.has(filter) || indById.has(filter) ? filter : "all";
  const filtered = ranked.filter(p => effFilter === "all" || industryOf(p)?.id === effFilter);

  const wished = useMemo(() => new Set(wishIds), [wishIds]);
  useEffect(() => { try { localStorage.setItem(WISH_KEY, JSON.stringify(wishIds)); } catch { /* storage unavailable */ } }, [wishIds]);
  // Forget saved items that an admin has since hidden or deleted.
  useEffect(() => {
    if (d.status !== "ready") return;
    const ids = new Set(d.products.map(p => p.id));
    setWishIds(w => { const n = w.filter(id => ids.has(id)); return n.length === w.length ? w : n; });
  }, [d.status, d.products]);
  const wishProducts = wishIds.map(id => d.products.find(p => p.id === id)).filter((p): p is PublicProduct => !!p);

  const notice = useCallback((text: string, act = false) => {
    setToast({ text, act });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);
  const changeMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ }
    setCart(c => c.filter(l => { const p = d.products.find(x => x.id === l.productId); return !p || allows(p, m); }));
  };
  const inCart = useCallback((id: string) => cart.some(l => l.productId === id), [cart]);
  const add = useCallback((p: PublicProduct) => {
    if (cart.some(l => l.productId === p.id)) { setQuoteOpen(true); return; }
    setCart(c => [...c, { key: newKey(), productId: p.id, qty: defaultQty(p, mode) }]);
    notice(`${p.name} added to your request`, true);
  }, [cart, mode, notice]);
  const toggleWish = useCallback((id: string) => setWishIds(w => (w.includes(id) ? w.filter(x => x !== id) : [...w, id])), []);

  const go = useCallback((id: string) => {
    setPanel(null);
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, []);
  const showIndustry = (id: string) => {
    const ind = indById.get(id);
    if (ind?.storefront === "fashion") { navigate("/clothing"); return; }
    setFilter(id); setLimit(PAGE);
    go(byInd.has(id) ? `ind-${id}` : "products");
  };
  const viewAll = (id: string) => { setFilter(id); setLimit(PAGE); go("products"); };

  useEffect(() => {
    const on = () => setSolid(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => { window.removeEventListener("scroll", on); };
  }, []);
  useEffect(() => {
    if (panel !== "inds") return undefined;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".mk-dd")) setPanel(null); };
    document.addEventListener("mousedown", close);
    return () => { document.removeEventListener("mousedown", close); };
  }, [panel]);
  useReveal();

  const ctx: Ctx = { mode, wished, toggleWish, inCart, add, open: setDetail, catName, industryOf, photo };
  const term = q.trim().toLowerCase();
  const supCatNames = (id: string) => d.supCats.filter(x => x.supplier_id === id).map(x => catById.get(x.category_id)?.name).filter((n): n is string => !!n);
  const supOpen = (s: Supplier) => (
    <SupplierCard key={s.id} s={s} ind={indById.get(s.industry_id)} cats={supCatNames(s.id)} onOpen={() => setSupplier(s)} />
  );
  const hits = useMemo(() => {
    if (!term) return null;
    const prods = visible.filter(p => `${p.name} ${p.category} ${p.brand ?? ""} ${industryOf(p)?.name ?? ""} ${p.description ?? ""}`.toLowerCase().includes(term));
    const sups = d.suppliers.filter(s => `${s.name} ${s.location ?? ""} ${indById.get(s.industry_id)?.name ?? ""}`.toLowerCase().includes(term));
    const matchInds = inds.filter(i => i.name.toLowerCase().includes(term));
    return { prods, sups, matchInds };
  }, [term, visible, d.suppliers, inds, indById, industryOf]);

  const submitSearch = (e: React.FormEvent) => { e.preventDefault(); if (term) go("results"); };
  const headerIndustries = inds;
  const hasProducts = d.products.length > 0;
  const stateMsg = d.status === "loading" ? "Loading products…"
    : d.status === "offline" ? "The product catalogue is not connected yet."
    : d.status === "error" ? "We could not load the products. Please refresh the page."
    : !hasProducts ? "Products are being added. Please check back soon." : "";
  const NAV: { id: string; label: string; show: boolean }[] = [
    { id: "products", label: "Products", show: true },
    { id: "suppliers", label: "Suppliers", show: d.suppliers.length > 0 },
    { id: "contact", label: "Contact", show: true },
  ];

  return (
    <div className="mk">
      <header className={`mk-header${solid ? " solid" : ""}`}>
        <div className="mk-header-in">
          <button className="mk-icon mk-burger" aria-label="Open menu" aria-expanded={panel === "menu"} onClick={() => setPanel("menu")}><Menu size={20} /></button>
          <a className="mk-logo" href="#top" aria-label="TradeLink home" onClick={e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Brand /></a>
          <nav className="mk-nav" aria-label="Main">
            <div className="mk-dd">
              <button className={panel === "inds" ? "on" : ""} aria-expanded={panel === "inds"} onClick={() => setPanel(p => (p === "inds" ? null : "inds"))}>Industries <ChevronDown size={14} /></button>
              {panel === "inds" && (
                <ul className="mk-dd-list">
                  {headerIndustries.map(i => <li key={i.id}><button onClick={() => { setPanel(null); showIndustry(i.id); }}><IconFor name={i.icon} size={16} /> {i.name}</button></li>)}
                </ul>
              )}
            </div>
            {NAV.filter(n => n.show).map(n => <button key={n.id} onClick={() => go(n.id)}>{n.label}</button>)}
          </nav>
          <form className="mk-hsearch" role="search" onSubmit={submitSearch}>
            <Search size={16} />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search products, categories, brands and suppliers" />
          </form>
          <div className="mk-actions">
            <button className="mk-icon mk-sbtn" aria-label="Search" onClick={() => { go("top"); window.setTimeout(() => heroSearch.current?.focus(), 350); }}><Search size={19} /></button>
            <button className="mk-icon" aria-label={`Wishlist${wishIds.length ? `, ${wishIds.length} saved` : ""}`} onClick={() => setPanel("wish")}><Heart size={19} />{wishIds.length > 0 && <i>{wishIds.length}</i>}</button>
            <button className="mk-icon" aria-label={`Your request${cart.length ? `, ${cart.length} items` : ""}`} onClick={() => setQuoteOpen(true)}><ShoppingBag size={19} />{cart.length > 0 && <i>{cart.length}</i>}</button>
            <button className="mk-icon" aria-label="Staff sign in" title="Staff sign in" onClick={() => navigate("/login")}><UserRound size={19} /></button>
          </div>
        </div>
      </header>

      {panel === "menu" && (
        <div className="mk-scrim left" onMouseDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
          <MenuPanel onClose={() => setPanel(null)}>
            <button onClick={() => go("top")}>Home</button>
            <p className="mk-side-h">Industries</p>
            {headerIndustries.map(i => <button key={i.id} onClick={() => { setPanel(null); showIndustry(i.id); }}><IconFor name={i.icon} size={16} /> {i.name}</button>)}
            <p className="mk-side-h">More</p>
            {NAV.filter(n => n.show).map(n => <button key={n.id} onClick={() => go(n.id)}>{n.label}</button>)}
            {app.canInstall && <button onClick={() => { setPanel(null); void app.install(); }}><Download size={16} /> Install TradeLink app</button>}
            {app.isIos && <small className="mk-muted">To install: tap Share, then “Add to Home Screen”.</small>}
            <button onClick={() => navigate("/login")}><UserRound size={16} /> Staff sign in</button>
          </MenuPanel>
        </div>
      )}

      <section className="mk-hero" id="top">
        <div className="mk-hero-in">
          <h1>Discover Everything. <span>Trade Everywhere.</span></h1>
          <p>Explore products and connect with businesses across multiple industries.</p>
          <form className="mk-bigsearch" role="search" onSubmit={submitSearch}>
            <Search size={19} />
            <input ref={heroSearch} value={q} onChange={e => setQ(e.target.value)} placeholder="Search products, brands, suppliers" aria-label="Search products, categories, brands and suppliers" />
            {q && <button type="button" className="mk-clear" aria-label="Clear search" onClick={() => setQ("")}><X size={16} /></button>}
            <button className="mk-btn dark" type="submit" aria-label="Search"><Search size={17} className="mk-bs-ico" /><span>Search</span></button>
          </form>
          <ModeSwitch mode={mode} onMode={changeMode} big />
        </div>
      </section>

      {hits && (
        <section className="mk-sec" id="results" aria-live="polite">
          <div className="mk-head"><h2>Results for “{q.trim()}”</h2><button className="mk-link" onClick={() => setQ("")}>Clear <X size={14} /></button></div>
          {hits.matchInds.length > 0 && <div className="mk-chips">{hits.matchInds.map(i => <button key={i.id} onClick={() => showIndustry(i.id)}><IconFor name={i.icon} size={14} /> {i.name}</button>)}</div>}
          {hits.prods.length > 0 && <div className="mk-grid">{hits.prods.slice(0, 8).map((p, i) => <ProductCard key={p.id} p={p} c={ctx} i={i} />)}</div>}
          {hits.sups.length > 0 && <div className="mk-sups">{hits.sups.map(supOpen)}</div>}
          {!hits.prods.length && !hits.sups.length && !hits.matchInds.length && <p className="mk-empty">Nothing matches your search.</p>}
        </section>
      )}

      <section className="mk-sec" id="industries">
        <div className="mk-head" data-rv=""><h2>Shop by industry</h2></div>
        {inds.length === 0 ? <p className="mk-empty">{stateMsg || "Industries are being set up."}</p> : (
          <div className="mk-inds">
            {inds.map((i, n) => {
              const count = byInd.get(i.id)?.length ?? 0;
              return (
                <button key={i.id} className={`mk-ind${effFilter === i.id ? " on" : ""}${count === 0 ? " none" : ""}`} data-rv="" style={delay(n % 4)} onClick={() => showIndustry(i.id)}>
                  <span className="mk-ind-ico"><IconFor name={i.icon} size={18} /></span>
                  <span className="mk-ind-txt"><b>{i.name}</b><small>{count > 0 ? `${count} ${count === 1 ? "product" : "products"}` : "No products yet"}</small></span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {inds.filter(i => (byInd.get(i.id)?.length ?? 0) > 0).map(i => (
        <section className="mk-sec tight" id={`ind-${i.id}`} key={i.id}>
          <div className="mk-head" data-rv="">
            <h2><span className="mk-h-ico"><IconFor name={i.icon} size={17} /></span>{i.name}</h2>
            {i.storefront === "fashion"
              ? <Link className="mk-link" to="/clothing">View All <ArrowRight size={14} /></Link>
              : <button className="mk-link" onClick={() => viewAll(i.id)}>View All <ArrowRight size={14} /></button>}
          </div>
          <div className="mk-grid">{pick(byInd.get(i.id)!, catKey).map((p, n) => <ProductCard key={p.id} p={p} c={ctx} i={n} />)}</div>
        </section>
      ))}

      <section className="mk-sec" id="products">
        <div className="mk-head" data-rv="">
          <h2>{bestVisible.length > 0 ? "Popular Products" : "Products"}</h2>
          <ModeSwitch mode={mode} onMode={changeMode} />
        </div>
        {hasProducts && (
          <div className="mk-chips" role="group" aria-label="Filter by industry" data-rv="">
            <button className={effFilter === "all" ? "on" : ""} aria-pressed={effFilter === "all"} onClick={() => { setFilter("all"); setLimit(PAGE); }}>All</button>
            {inds.filter(i => (byInd.get(i.id)?.length ?? 0) > 0 || i.id === effFilter).map(i => (
              <button key={i.id} className={effFilter === i.id ? "on" : ""} aria-pressed={effFilter === i.id} onClick={() => { setFilter(i.id); setLimit(PAGE); }}><IconFor name={i.icon} size={14} /> {i.name}</button>
            ))}
          </div>
        )}
        {filtered.length === 0
          ? <p className="mk-empty">{stateMsg || (effFilter !== "all" ? `No ${indById.get(effFilter)?.name ?? "products"} products are listed for ${mode === "business" ? "businesses" : "individuals"} yet.` : `No products are listed for ${mode === "business" ? "businesses" : "individuals"} yet. Try the other option.`)}</p>
          : <div className="mk-grid">{filtered.slice(0, limit).map((p, n) => <ProductCard key={p.id} p={p} c={ctx} i={n} />)}</div>}
        {filtered.length > limit && <div className="mk-center"><button className="mk-btn line" onClick={() => setLimit(l => l + PAGE)}>Show more</button></div>}
      </section>

      {d.suppliers.length > 0 && (
        <section className="mk-sec" id="suppliers">
          <div className="mk-head" data-rv=""><h2>Suppliers</h2></div>
          <div className="mk-sups">{d.suppliers.slice(0, 8).map(supOpen)}</div>
        </section>
      )}

      <footer className="mk-footer" id="contact">
        <div className="mk-footer-in">
          <div className="mk-f-brand">
            <Brand />
            <p>A multi-industry marketplace for individuals and businesses.</p>
            <ContactRow />
          </div>
          <nav aria-label="Industries">
            <h4>Industries</h4>
            {inds.slice(0, 8).map(i => <button key={i.id} onClick={() => showIndustry(i.id)}>{i.name}</button>)}
          </nav>
          <nav aria-label="Support">
            <h4>Support</h4>
            <button onClick={() => setQuoteOpen(true)}>Request a price</button>
            <button onClick={() => go("products")}>Products</button>
            {d.suppliers.length > 0 && <button onClick={() => go("suppliers")}>Suppliers</button>}
            <button onClick={() => navigate("/login")}>Staff sign in</button>
          </nav>
        </div>
        <small className="mk-copy">© {new Date().getFullYear()} TradeLink</small>
      </footer>

      {toast && (
        <div className="mk-toast" role="status">
          <span>{toast.text}</span>
          {toast.act && <button onClick={() => { setToast(null); setQuoteOpen(true); }}>Send <ArrowRight size={14} /></button>}
        </div>
      )}
      {panel === "wish" && (
        <div className="mk-scrim right" onMouseDown={e => { if (e.target === e.currentTarget) setPanel(null); }}>
          <WishPanel products={wishProducts} c={ctx} onClose={() => setPanel(null)} />
        </div>
      )}
      {!detail && !supplier && !quoteOpen && !panel && <FloatingContact />}
      {detail && <Details p={detail} c={ctx} onClose={() => setDetail(null)} />}
      {supplier && <SupplierDialog s={supplier} ind={indById.get(supplier.industry_id)} cats={supCatNames(supplier.id)} onClose={() => setSupplier(null)} />}
      {quoteOpen && <RequestModal products={d.products} mode={mode} onMode={changeMode} initial={cart} onLines={setCart} onClose={() => setQuoteOpen(false)} onSent={() => setCart([])} />}
    </div>
  );
}

function MenuPanel({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useDialog(onClose);
  return (
    <aside className="mk-side" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="mk-side-top"><Brand /><button className="mk-icon" aria-label="Close menu" onClick={onClose}><X size={20} /></button></div>
      <div className="mk-side-list">{children}</div>
    </aside>
  );
}

function WishPanel({ products, c, onClose }: { products: PublicProduct[]; c: Ctx; onClose: () => void }) {
  useDialog(onClose);
  return (
    <aside className="mk-side right" role="dialog" aria-modal="true" aria-label="Wishlist">
      <div className="mk-side-top"><h2>Wishlist</h2><button className="mk-icon" aria-label="Close wishlist" onClick={onClose}><X size={20} /></button></div>
      <div className="mk-side-list">
        {products.length === 0 && <p className="mk-empty small"><Heart size={22} /> Nothing saved yet</p>}
        {products.map(p => {
          const { now } = priceOf(p, c.mode);
          const img = c.photo(p);
          return (
            <div className="mk-wish" key={p.id}>
              <button className="mk-wish-img" onClick={() => { onClose(); c.open(p); }} aria-label={`View ${p.name}`}>{img ? <img src={img} alt="" loading="lazy" /> : <span className="mk-ph"><IconFor name={c.industryOf(p)?.icon} size={20} /></span>}</button>
              <div><b>{p.name}</b><small>{now !== null ? money(now) : "Price on request"}</small></div>
              <button className="mk-icon" aria-label={`Remove ${p.name}`} onClick={() => c.toggleWish(p.id)}><X size={16} /></button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

