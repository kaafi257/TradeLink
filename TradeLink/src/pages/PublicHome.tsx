import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, Briefcase, Candy, Check, ChevronsDown, ClipboardList, Download, Droplets, Headphones, Home, Layers, LayoutGrid, LogIn, Menu, MessageCircle,
  Package, PackageOpen, Phone, Plus, Search, ShieldCheck, Ship, ShoppingBag, Sparkles, Tag, Trash2, Truck, User, Warehouse, Wheat, X,
} from "lucide-react";
import { Brand } from "../components/Brand";
import { ContactCards, ContactPills, ContactRow, FloatingContact } from "../components/ContactActions";
import { TURNSTILE_SITE_KEY, Turnstile } from "../components/Turnstile";
import { useChannels, useContact } from "../lib/contact";
import { money } from "../lib/format";
import { IconFor } from "../lib/icons";
import { useInstall } from "../lib/install";
import { supabase, type PublicCategory, type PublicIndustry, type PublicProduct } from "../lib/supabase";
import "./home.css";

const NAV = [
  { id: "top", label: "Home", Icon: Home },
  { id: "public-products", label: "Shop", Icon: ShoppingBag },
  { id: "why", label: "About Us", Icon: Sparkles },
  { id: "contact", label: "Contact", Icon: MessageCircle },
];
const HERO_ITEMS = [
  { Icon: Wheat, word: "Rice" },
  { Icon: Candy, word: "Sugar" },
  { Icon: Droplets, word: "Oil" },
];
const ROUTE = [
  { Icon: Package, label: "Bulk" },
  { Icon: Ship, label: "Port" },
  { Icon: Warehouse, label: "Stored" },
  { Icon: Truck, label: "Delivered" },
];
const POINTS = [
  { Icon: ShieldCheck, title: "Quality" },
  { Icon: Tag, title: "Best prices" },
  { Icon: Layers, title: "Many products" },
  { Icon: Headphones, title: "Real support" },
];
const STEPS = [
  { Icon: Package, label: "Choose" },
  { Icon: Tag, label: "Get price" },
  { Icon: Truck, label: "Delivery" },
];

/** True once the element has scrolled into view (so entrance animations play when seen, not on page load). */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

/** Fades and lifts elements marked `data-rv` as they scroll into view (a data attribute, so React re-renders never undo it). */
function useReveal(deps: unknown[]) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-rv]:not([data-in])"));
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach(e => e.setAttribute("data-in", "")); return; }
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.setAttribute("data-in", ""); io.unobserve(e.target); }
    }), { threshold: 0.12 });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

export type Mode = "business" | "individual";
export type Line = { key: string; productId: string; qty: string };
type Status = "loading" | "ready" | "error" | "offline";

const MODE_KEY = "tradelink-mode";
const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === "individual" ? "individual" : "business"; } catch { return "business"; } };
const audienceOf = (p: PublicProduct) => p.audience ?? "both";
const allows = (p: PublicProduct, m: Mode) => audienceOf(p) === "both" || audienceOf(p) === (m === "individual" ? "b2c" : "b2b");
const defaultQty = (p: PublicProduct | undefined, m: Mode) => (m === "individual" ? "1" : String(Number(p?.min_order_quantity ?? 1)));
const catKey = (p: PublicProduct) => p.category_id ?? `name:${p.category}`;
const productLabel = (p: PublicProduct) => (p.package_size ? `${p.name} — ${p.package_size}` : p.name);
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

/** Also used by the fashion storefront. `extraNotes` adds a line per product (e.g. size and colour); `lockType` hides the wholesale switch. */
export function RequestModal({ products, mode, onMode, initial, onLines, onClose, onSent, extraNotes, lockType }: {
  products: PublicProduct[]; mode: Mode; onMode: (m: Mode) => void; initial: Line[]; onLines: (l: Line[]) => void; onClose: () => void; onSent: () => void;
  extraNotes?: Record<string, string>; lockType?: boolean;
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
    const extra = chosen.filter(l => extraNotes?.[l.productId]).map(l => `${byId.get(l.productId)?.name}: ${extraNotes![l.productId]}`).join("\n");
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
            <ContactPills message={`Hello TradeLink, my request reference is ${quoteNumber}.`} />
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

export default function PublicHome() {
  const navigate = useNavigate();
  const app = useInstall();
  const [routeRef, routeSeen] = useInView<HTMLOListElement>();
  const [whyRef, whySeen] = useInView<HTMLDivElement>();
  const [stepsRef, stepsSeen] = useInView<HTMLOListElement>();
  const contact = useContact();
  const reach = useChannels();
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [industries, setIndustries] = useState<PublicIndustry[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [status, setStatus] = useState<Status>(supabase ? "loading" : "offline");
  const [mode, setModeState] = useState<Mode>(readMode);
  const [cart, setCart] = useState<Line[]>([]);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [industryId, setIndustryId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [search, setSearch] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("top");
  const [solid, setSolid] = useState(false);
  const hasCart = cart.length > 0 && !quoteOpen;

  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const header = document.querySelector<HTMLElement>(".hm-header")?.offsetHeight ?? 72;
    const y = id === "top" ? 0 : el.getBoundingClientRect().top + window.scrollY - header + 1;
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    history.replaceState(null, "", `#${id}`);
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    const ids = NAV.map(n => n.id);
    const onScroll = () => {
      const header = document.querySelector<HTMLElement>(".hm-header")?.offsetHeight ?? 72;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      let current = "top";
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= header + 120) current = id;
      }
      setActive(atBottom ? "contact" : current);
      setSolid(window.scrollY > 24);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [products.length]);

  // Escape closes the phone menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => go(id), 300);
  }, [go]);

  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase.from("public_products").select("*").order("name"),
      supabase.from("public_industries").select("*").order("sort_order").order("name"),
      supabase.from("public_categories").select("*").order("sort_order").order("name"),
    ]).then(([p, i, c]) => {
      if (p.error) { setStatus("error"); return; }
      setProducts((p.data ?? []) as PublicProduct[]);
      setIndustries(i.error ? [] : ((i.data ?? []) as PublicIndustry[]));
      setCategories(c.error ? [] : ((c.data ?? []) as PublicCategory[]));
      setStatus("ready");
    });
  }, []);

  // Before migration 0005 (or with no industries), fall back to the category names found on the products.
  const { inds, cats } = useMemo(() => {
    if (industries.length && categories.length) return { inds: industries, cats: categories };
    const names = Array.from(new Set(products.map(p => p.category))).sort();
    return {
      inds: [{ id: "__all", name: "All products", description: null, icon: "package", sort_order: 0 }] as PublicIndustry[],
      cats: names.map((n, i) => ({ id: `name:${n}`, industry_id: "__all", name: n, description: null, image_url: null, sort_order: i })) as PublicCategory[],
    };
  }, [industries, categories, products]);

  const catById = useMemo(() => new Map(cats.map(c => [c.id, c])), [cats]);
  const indById = useMemo(() => new Map(inds.map(i => [i.id, i])), [inds]);
  // Industries set to the fashion storefront live on /clothing, so their products stay out of this shop.
  const fashionCats = useMemo(() => new Set(cats.filter(c => indById.get(c.industry_id)?.storefront === "fashion").map(c => c.id)), [cats, indById]);
  const visible = useMemo(() => products.filter(p => allows(p, mode) && !fashionCats.has(catKey(p))), [products, mode, fashionCats]);
  const fashionTabs = useMemo(() => inds.filter(i => i.storefront === "fashion" && products.some(p => allows(p, "individual") && catById.get(catKey(p))?.industry_id === i.id)), [inds, products, catById]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const p of visible) m.set(catKey(p), (m.get(catKey(p)) ?? 0) + 1); return m; }, [visible]);
  const indTabs = inds.filter(i => cats.some(c => c.industry_id === i.id && (counts.get(c.id) ?? 0) > 0));
  const effIndustry = indTabs.some(i => i.id === industryId) ? industryId : "all";
  const tiles = cats.filter(c => (effIndustry === "all" || c.industry_id === effIndustry) && (counts.get(c.id) ?? 0) > 0);
  const effCategory = categoryId !== "all" && tiles.some(c => c.id === categoryId) ? categoryId : "all";
  const q = search.trim().toLowerCase();
  const shown = visible.filter(p =>
    (effCategory === "all" || catKey(p) === effCategory) &&
    (effIndustry === "all" || catById.get(catKey(p))?.industry_id === effIndustry) &&
    (!q || `${p.name} ${p.category} ${p.package_size ?? ""}`.toLowerCase().includes(q)));

  const changeMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ }
    setCart(c => c.filter(l => { const p = products.find(x => x.id === l.productId); return !p || allows(p, m); }));
  };
  const inCart = (id: string) => cart.some(l => l.productId === id);
  const addToRequest = (p: PublicProduct) => {
    if (inCart(p.id)) { setQuoteOpen(true); return; }
    setCart(c => [...c, { key: newKey(), productId: p.id, qty: defaultQty(p, mode) }]);
  };
  const pickIndustry = (id: string) => { setIndustryId(id); setCategoryId("all"); };
  const chooseAudience = (m: Mode) => { changeMode(m); go("public-products"); };

  const emptyMessage =
    status === "loading" ? "Loading…"
    : status === "offline" ? "Catalogue not connected yet."
    : status === "error" ? "Could not load products. Please refresh."
    : visible.length === 0 && products.length > 0 ? "Nothing here yet. Try the other option."
    : q ? "No matches."
    : "Products coming soon.";

  useReveal([shown.length, tiles.length, effIndustry, effCategory, mode, status, indTabs.length]);

  return (
    <div className={`public-site${hasCart ? " has-cart" : ""}`}>
      <header className={`hm-header${solid || menuOpen ? " solid" : ""}`}>
        <a href="#top" className="brand-link" onClick={e => { e.preventDefault(); go("top"); }}><Brand light /></a>
        <nav aria-label="Main">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} className={active === n.id ? "active" : ""} aria-current={active === n.id ? "true" : undefined}
               onClick={e => { e.preventDefault(); go(n.id); }}><n.Icon size={16} />{n.label}</a>
          ))}
        </nav>
        {contact.phone && <a className="hm-tel" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} title="Call" aria-label="Call"><Phone size={18} /></a>}
        <button className="btn gold hm-quote" aria-label={`Request a price${cart.length > 0 ? `, ${cart.length} in your request` : ""}`} onClick={() => setQuoteOpen(true)}>
          <ClipboardList size={16} />
          <span className="hm-q-full">Request a price</span><span className="hm-q-short">Get price</span><span className="hm-q-xs">Quote</span>{cart.length > 0 && <span> ({cart.length})</span>}
        </button>
        <button className="hm-staff" onClick={() => navigate("/login")} title="Staff login" aria-label="Staff login"><LogIn size={16} /> Staff</button>
        <button className="hm-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="hm-mobile-menu" onClick={() => setMenuOpen(o => !o)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      {menuOpen && <button className="hm-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />}
      {menuOpen && (
        <div className="hm-mobile" id="hm-mobile-menu" role="menu">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} role="menuitem" className={active === n.id ? "active" : ""} onClick={e => { e.preventDefault(); go(n.id); }}><n.Icon size={20} />{n.label}</a>
          ))}
          <div className="hm-mobile-icons"><ContactRow /></div>
          {app.canInstall && <button className="hm-install" role="menuitem" onClick={() => { setMenuOpen(false); void app.install(); }}><Download size={18} /> Install app</button>}
          {app.isIos && <p className="hm-install-hint">Tap Share, then “Add to Home Screen”.</p>}
          <a href="/login" role="menuitem" onClick={e => { e.preventDefault(); navigate("/login"); }}><LogIn size={20} />Staff</a>
        </div>
      )}

      <section className="hm-hero" id="top">
        <img className="hm-hero-bg" src="/img/warehouse.jpg" alt="Racks and pallets stacked with goods inside the TradeLink warehouse" />
        <div className="hm-hero-shade" />
        <div className="hm-hero-copy">
          <h1 className="hm-title" aria-label="Rice, sugar and oil">
            {HERO_ITEMS.map(({ Icon, word }, i) => (
              <span className="hm-word" key={word} style={{ "--i": i } as React.CSSProperties} aria-hidden="true">
                <span className="hm-word-ico"><Icon size={34} /></span>{word}
              </span>
            ))}
          </h1>
          <div className="hm-audience" role="group" aria-label="Who are you buying for?">
            <button className={mode === "business" ? "on" : ""} aria-pressed={mode === "business"} onClick={() => chooseAudience("business")}>
              <span className="tag-ico"><Briefcase size={26} /></span>
              <b>Business</b>
              <ArrowRight className="tag-go" size={20} />
            </button>
            <button className={mode === "individual" ? "on" : ""} aria-pressed={mode === "individual"} onClick={() => chooseAudience("individual")}>
              <span className="tag-ico"><User size={26} /></span>
              <b>Personal</b>
              <ArrowRight className="tag-go" size={20} />
            </button>
          </div>
          {reach.length > 0 && <div className="hm-reach"><ContactPills /></div>}
        </div>
        <button className="hm-scroll" aria-label="Scroll to shop" onClick={() => go("public-products")}><ChevronsDown size={26} /></button>
      </section>

      <section className="hm-route" aria-label="From the port to your door">
        <img className="hm-scene" src="/img/port-scene.svg" alt="Illustration of a container ship unloading at a port crane, with a truck loaded with goods driving past the warehouse" />
        <div className="hm-route-body">
          <div className="hm-route-track">
            <ol className={`hm-route-steps${routeSeen ? " in" : ""}`} ref={routeRef}>
              {ROUTE.map(({ Icon, label }, i) => <li key={label} style={{ "--i": i } as React.CSSProperties}><span className="stop"><Icon size={26} /></span><b>{label}</b></li>)}
            </ol>
            {routeSeen && <span className="route-truck" aria-hidden="true"><Truck size={20} /></span>}
          </div>
        </div>
      </section>

      <section className="hm-section" id="public-products">
        <div className="hm-head hm-shop-head">
          <div><h2 className="hm-h2-ico"><span className="h2-badge"><ShoppingBag size={26} /></span>Shop</h2></div>
          <div className="seg seg-light" role="group" aria-label="I am buying as">
            <button className={mode === "business" ? "on" : ""} aria-pressed={mode === "business"} onClick={() => changeMode("business")}><Briefcase size={15} /> Business</button>
            <button className={mode === "individual" ? "on" : ""} aria-pressed={mode === "individual"} onClick={() => changeMode("individual")}><User size={15} /> Individual</button>
          </div>
        </div>

        {indTabs.length + fashionTabs.length > 1 && (
          <div className="hm-filters hm-industries" role="group" aria-label="Filter by industry">
            <button className={effIndustry === "all" ? "on" : ""} aria-pressed={effIndustry === "all"} onClick={() => pickIndustry("all")}><LayoutGrid size={15} /> All</button>
            {indTabs.map(i => <button key={i.id} className={effIndustry === i.id ? "on" : ""} aria-pressed={effIndustry === i.id} onClick={() => pickIndustry(i.id)}><IconFor name={i.icon} size={15} /> {i.name}</button>)}
            {fashionTabs.map(i => <button key={i.id} className="fashion-tab" onClick={() => navigate("/clothing")}><IconFor name={i.icon} size={15} /> {i.name} <ArrowRight size={14} /></button>)}
          </div>
        )}

        {tiles.length > 0 && (
          <div className="hm-tiles">
            {tiles.map((c, i) => (
              <button key={c.id} data-rv="" style={{ "--i": Math.min(i, 8) } as React.CSSProperties} className={`hm-tile${effCategory === c.id ? " on" : ""}`} aria-pressed={effCategory === c.id} onClick={() => setCategoryId(effCategory === c.id ? "all" : c.id)}>
                {c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <span className="tile-ph"><IconFor name={indById.get(c.industry_id)?.icon} size={34} /></span>}
                <span className="tile-info"><b>{c.name}</b><small><Package size={13} /> {counts.get(c.id)}</small></span>
              </button>
            ))}
          </div>
        )}

        <div className="hm-toolbar">
          <label className="hm-search"><Search size={17} /><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search products" aria-label="Search products" /></label>
          <span className="hm-count" aria-label={`${shown.length} ${shown.length === 1 ? "product" : "products"}`}><Package size={17} /> {shown.length}{effCategory !== "all" && <button onClick={() => setCategoryId("all")} aria-label="Clear category" title="Clear category"><X size={16} /></button>}</span>
        </div>

        {shown.length === 0 ? <p className="hm-empty"><PackageOpen size={22} /> {emptyMessage}</p> : (
          <div className="hm-grid">
            {shown.map((p, i) => {
              const catImg = catById.get(catKey(p))?.image_url;
              const img = p.image_url || catImg;
              const ind = indById.get(catById.get(catKey(p))?.industry_id ?? "");
              const added = inCart(p.id);
              return (
                <article className="hm-card" key={p.id} data-rv="" style={{ "--i": i % 4 } as React.CSSProperties}>
                  <div className="media">
                    {img ? <img src={img} alt={p.name} loading="lazy" /> : <div className="ph" role="img" aria-label={p.name}><IconFor name={ind?.icon} size={44} /></div>}
                    <span className="badge">{p.category}</span>
                  </div>
                  <div className="body">
                    <h3>{p.name}</h3>
                    <div className="chips">
                      <span className="chip"><Package size={14} />{p.package_size || p.unit}</span>
                      {mode === "business" && <span className="chip gold"><Tag size={14} />Min. {Number(p.min_order_quantity)} {p.unit}</span>}
                    </div>
                    <div className="price">
                      {mode === "individual" && Number(p.retail_price) > 0
                        ? <><b>{money(Number(p.retail_price))}</b><small>per {p.unit}</small></>
                        : <small className="ask"><Tag size={14} /> Ask</small>}
                    </div>
                    <button className={`btn cta ${added ? "gold" : "green"}`} onClick={() => addToRequest(p)} aria-label={added ? `${p.name} is in your request` : `Add ${p.name} to your request`}>
                      {added ? <><Check className="pop" size={18} /> Added</> : <><Plus size={18} /> Add</>}
                    </button>
                    <ContactPills message={`Hello TradeLink, I would like ${mode === "individual" ? "a price" : "a wholesale price"} for ${productLabel(p)}.`} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="hm-why" id="why">
        <div className="hm-section hm-about">
          <h2 className="hm-h2-ico"><span className="h2-badge"><Sparkles size={26} /></span>Why us</h2>
          <div className={`hm-points${whySeen ? " in" : ""}`} ref={whyRef}>
            {POINTS.map(({ Icon, title }, i) => (
              <div key={title} style={{ "--i": i } as React.CSSProperties}><span className="hm-ico"><Icon size={30} /></span><h3>{title}</h3></div>
            ))}
          </div>
        </div>
      </section>

      <section className="hm-contact" id="contact">
        <div className="hm-section hm-contact-grid">
          <div>
            <h2 className="hm-h2-ico"><span className="h2-badge"><ClipboardList size={26} /></span>Order now</h2>
            <ol className={`hm-steps${stepsSeen ? " in" : ""}`} ref={stepsRef}>
              {STEPS.map(({ Icon, label }, i) => <li key={label} style={{ "--i": i } as React.CSSProperties}><span className="stop"><Icon size={24} /></span><b>{label}</b></li>)}
            </ol>
          </div>
          <div className="hm-contact-panel">
            {reach.length > 0 && <ContactCards />}
            <button className="btn gold hm-big" onClick={() => setQuoteOpen(true)}><ClipboardList size={20} /> Get a price</button>
          </div>
        </div>
      </section>

      <footer className="hm-footer">
        <div className="hm-footer-top">
          <Brand light />
          <nav aria-label="Footer">{NAV.map(n => <a key={n.id} href={`#${n.id}`} onClick={e => { e.preventDefault(); go(n.id); }}><n.Icon size={16} />{n.label}</a>)}</nav>
        </div>
        <div className="hm-footer-icons"><ContactRow /></div>
        <small className="hm-copy">© {new Date().getFullYear()} TradeLink</small>
      </footer>

      {cart.length > 0 && !quoteOpen && (
        <div className="hm-cartbar" role="status">
          <span aria-label={`${cart.length} ${cart.length === 1 ? "product" : "products"} in your request`}><ClipboardList size={20} /><b>{cart.length}</b></span>
          <button className="btn gold" onClick={() => setQuoteOpen(true)}>Send <ArrowRight size={15} /></button>
        </div>
      )}
      <FloatingContact />
      {quoteOpen && <RequestModal products={products} mode={mode} onMode={changeMode} initial={cart} onLines={setCart} onClose={() => setQuoteOpen(false)} onSent={() => setCart([])} />}
    </div>
  );
}
