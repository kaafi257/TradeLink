import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Briefcase, Check, ClipboardList, Package, Percent, Plus, Search, ShoppingBag, Sparkles, Tag, Trash2, User, X, Layers } from "lucide-react";

import { ContactIcons, ContactPills, FloatingContact } from "../components/ContactActions";
import { TURNSTILE_SITE_KEY, Turnstile } from "../components/Turnstile";
import { money } from "../lib/format";
import { IconFor } from "../lib/icons";
import { useInstall } from "../lib/install";
import { useAuth } from "../lib/auth";
import { track, trackState } from "../lib/track";
import { useWishlist } from "../lib/wishlist";
import { AnnouncementBar, BottomNav, ModeToggle, RfqBanner, RfqModal, ShopByIndustry, SupplierStrip, TradeHeader, TradeHero, TradeNav, TradeRow } from "./market/Trade";
import { MarketFooter, MarketShop, ProductDialog, SupplierDialog, WishlistDrawer, type Shelf } from "./market/Market";
import { MODE_LOOK, lookFor, styleFor, type Look, type ShopStyle } from "../lib/theme";
import { supabase, type PublicCategory, type PublicIndustry, type PublicProduct, type PublicSupplier } from "../lib/supabase";
import "./home.css";

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

export default function PublicHome() {
  const navigate = useNavigate();
  const app = useInstall();
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
  const [rfqOpen, setRfqOpen] = useState(false);
  const { session, loading: authLoading } = useAuth();
  // Staff browsing the public site are not counted as visitors. One visit per browser tab.
  useEffect(() => {
    trackState.off = !!session;
    if (authLoading || session) return;
    try { if (sessionStorage.getItem("tl-visit")) return; sessionStorage.setItem("tl-visit", "1"); } catch { /* storage unavailable */ }
    track("visit", { mode: readMode() });
  }, [authLoading, session]);
  const wish = useWishlist();
  const [bestIds, setBestIds] = useState<string[]>([]);
  const [suppliers, setSuppliers] = useState<PublicSupplier[]>([]);
  const [supCats, setSupCats] = useState<{ supplier_id: string; category_id: string }[]>([]);
  const [supplier, setSupplier] = useState<PublicSupplier | null>(null);
  const [quick, setQuick] = useState<PublicProduct | null>(null);
  const [wishOpen, setWishOpen] = useState(false);
  const [heroQuery, setHeroQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const hasCart = cart.length > 0 && !quoteOpen;

  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const header = document.querySelector<HTMLElement>(".tl-head")?.offsetHeight ?? 72;
    const y = id === "top" ? 0 : el.getBoundingClientRect().top + window.scrollY - header + 1;
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    history.replaceState(null, "", `#${id}`);
    setMenuOpen(false);
  }, []);

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
      // Real sales ranking (migration 0006). Without it the page simply shows the newest products.
      // Suppliers directory (migration 0007). If it is not set up, the section is simply hidden.
      void supabase!.from("public_suppliers").select("*").order("name").then(r => { if (!r.error) setSuppliers((r.data ?? []) as PublicSupplier[]); });
      void supabase!.from("public_supplier_categories").select("*").then(r => { if (!r.error) setSupCats((r.data ?? []) as { supplier_id: string; category_id: string }[]); });
      void supabase!.from("public_best_sellers").select("*").order("rank").then(r => {
        if (!r.error) setBestIds(((r.data ?? []) as { product_id: string }[]).map(b => b.product_id));
      });
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
  const supCatNames = (id: string) => supCats.filter(x => x.supplier_id === id).map(x => cats.find(c => c.id === x.category_id)?.name).filter((n): n is string => !!n);
  const visible = useMemo(() => products.filter(p => allows(p, mode)), [products, mode]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const p of visible) m.set(catKey(p), (m.get(catKey(p)) ?? 0) + 1); return m; }, [visible]);
  const indTabs = inds.filter(i => cats.some(c => c.industry_id === i.id && (counts.get(c.id) ?? 0) > 0));
  const effIndustry = indTabs.some(i => i.id === industryId) ? industryId : "all";
  const tiles = cats.filter(c => (effIndustry === "all" || c.industry_id === effIndustry) && (counts.get(c.id) ?? 0) > 0);
  const looks = useMemo(() => new Map(cats.map(c => [c.id, lookFor(c.name, indById.get(c.industry_id)?.name)])), [cats, indById]);
  const lookVars = (l: Look) => ({ "--ca": l.a, "--cb": l.b, "--ct": l.tint, "--ci": l.ink, "--cp": l.pat }) as React.CSSProperties;
  const effCategory = categoryId !== "all" && tiles.some(c => c.id === categoryId) ? categoryId : "all";
  const q = search.trim().toLowerCase();
  const activeLook = effCategory !== "all" ? looks.get(effCategory) : undefined;
  const envLook = activeLook ?? MODE_LOOK[mode];
  const styleOf = (catId: string) => styleFor(indById.get(catById.get(catId)?.industry_id ?? "")?.name);
  const shopStyle: ShopStyle = effIndustry !== "all" ? styleFor(indById.get(effIndustry)?.name) : effCategory !== "all" ? styleOf(effCategory) : "food";
  const shown = visible.filter(p =>
    (effCategory === "all" || catKey(p) === effCategory) &&
    (effIndustry === "all" || catById.get(catKey(p))?.industry_id === effIndustry) &&
    (!q || `${p.name} ${p.category} ${p.package_size ?? ""}`.toLowerCase().includes(q)));

  const indOfP = (p: PublicProduct) => indById.get(catById.get(catKey(p))?.industry_id ?? "");
  const indCount = useMemo(() => { const m = new Map<string, number>(); for (const p of visible) { const id = catById.get(catKey(p))?.industry_id; if (id) m.set(id, (m.get(id) ?? 0) + 1); } return m; }, [visible, catById]);
  const mInds = inds.some(i => i.id !== "__all") ? inds.filter(i => i.id !== "__all") : inds;
  const allCount = useMemo(() => { const m = new Map<string, number>(); for (const p of products) { const id = catById.get(catKey(p))?.industry_id; if (id) m.set(id, (m.get(id) ?? 0) + 1); } return m; }, [products, catById]);
  // Every industry is listed in both buyer modes; one that only sells to the other type says so and switches when opened.
  const gridInds = mInds.filter(i => cats.some(c => c.industry_id === i.id)).map(i => {
    const count = indCount.get(i.id) ?? 0;
    const note = count === 0 && (allCount.get(i.id) ?? 0) > 0 ? (mode === "individual" ? "Wholesale only" : "Retail only") : undefined;
    return { ind: i, count, note };
  });
  const headerInds = gridInds.map(g => g.ind);
  const wishItems = products.filter(p => wish.has(p.id));
  const wishCount = wishItems.length;
  const openIndustry = (i: PublicIndustry) => {
    if ((indCount.get(i.id) ?? 0) === 0 && (allCount.get(i.id) ?? 0) > 0) changeMode(mode === "individual" ? "business" : "individual");
    track("industry_view", { ref: i.id });
    setSearch(""); setIndustryId(i.id); setCategoryId("all"); setMenuOpen(false); go("public-products");
  };
  const openCategory = (c: PublicCategory) => {
    track("category_view", { ref: c.id });
    setSearch(""); setIndustryId(c.industry_id); setCategoryId(c.id); go("public-products");
  };

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

  const shelf: Shelf = {
    mode, products: visible, industries: mInds, categories: cats, bestIds,
    indOf: indOfP, catName: p => catById.get(catKey(p))?.name ?? p.category, isFashion: () => false,
    inRequest: inCart, addToRequest, wished: wish.has, toggleWish: wish.toggle, open: setQuick,
  };

  const byNew = (a: PublicProduct, b: PublicProduct) => (b.created_at ?? "").localeCompare(a.created_at ?? "");
  // Each product appears in one section only (offers are the one honest exception: a discount is a reason to show it again).
  const { featured, wholesaleList, newest } = useMemo(() => {
    const used = new Set<string>();
    const take = (list: PublicProduct[], n: number) => { const out = list.filter(p => !used.has(p.id)).slice(0, n); out.forEach(p => used.add(p.id)); return out; };
    const ok = products.filter(p => allows(p, mode));
    const ranked = [...bestIds.map(id => ok.find(p => p.id === id)).filter((p): p is PublicProduct => !!p), ...[...ok].sort(byNew)];
    const featured = take(ranked, 6);
    const wholesaleList = take(products.filter(p => audienceOf(p) !== "b2c").sort((a, b) => Number(b.min_order_quantity) - Number(a.min_order_quantity)), 6);
    const newest = take([...ok].sort(byNew), 6);
    return { featured, wholesaleList, newest };
  }, [products, bestIds, mode]);
  const offers = useMemo(() => products.filter(p => allows(p, "individual") && Number(p.retail_price) > 0 && Number(p.sale_price) > 0 && Number(p.sale_price) < Number(p.retail_price)).slice(0, 6), [products]);
  const slides = useMemo(() => mInds.map(ind => {
    const ps = visible.filter(p => catById.get(catKey(p))?.industry_id === ind.id);
    const img = ps.find(p => p.image_url)?.image_url ?? cats.find(c => c.industry_id === ind.id && c.image_url)?.image_url ?? null;
    return { ind, img, count: ps.length };
  }).filter(s => s.count > 0).slice(0, 5), [mInds, visible, catById, cats]);

  const emptyMessage =
    status === "loading" ? "Loading our products…"
    : status === "offline" ? "The product catalogue is not connected yet."
    : status === "error" ? "We could not load the product list. Please refresh the page."
    : visible.length === 0 && products.length > 0 ? `No products are listed for ${mode === "business" ? "businesses" : "individuals"} yet. Try the other option above.`
    : q ? "No products match your search."
    : "Our product list is being updated. Please check back soon or contact us.";

  return (
    <div className={`public-site${hasCart ? " has-cart" : ""}`}>
      <AnnouncementBar products={products.length} industries={mInds.filter(i => (indCount.get(i.id) ?? 0) > 0).length} />
      <TradeHeader shelf={shelf} suppliers={suppliers} wishCount={wishCount} requestCount={cart.length} signedIn={!!session}
        onWishlist={() => setWishOpen(true)} onRequest={() => setQuoteOpen(true)} onAccount={() => navigate(session ? "/admin" : "/login")}
        onSearch={(text, ind) => {
          const t = text.trim().toLowerCase();
          if (t.length >= 2) track("search", { term: t, mode, results: products.filter(p => (ind === "all" || shelf.indOf(p)?.id === ind) && `${p.name} ${p.brand ?? ""} ${p.category}`.toLowerCase().includes(t)).length });
          setSearch(text); setIndustryId(ind); setCategoryId("all"); go("public-products");
        }}
        onPickIndustry={openIndustry} onPickCategory={openCategory} onSupplier={setSupplier} searchRef={searchRef}
        openMenu={() => setMenuOpen(v => !v)} menuOpen={menuOpen} />
      <TradeNav mode={mode} industries={headerInds} categories={cats} counts={counts} onMode={changeMode} onPickIndustry={openIndustry} onPickCategory={openCategory} open={menuOpen} setOpen={setMenuOpen} onRfq={() => setRfqOpen(true)} />
      <ModeToggle mode={mode} onMode={changeMode} className="mobile" />
      <TradeHero shelf={shelf} slides={slides} counts={counts} onPickIndustry={openIndustry} onPickCategory={openCategory} />
      <ShopByIndustry items={gridInds} onPick={i => openIndustry(i)} />
      <TradeRow id="featured" title="Featured products" sub="Best sellers and popular picks" shelf={shelf} items={featured} onAll={() => go("public-products")} />
      <TradeRow id="wholesale" title="Wholesale sourcing" sub="Buy in bulk. Minimum order shown." shelf={shelf} mode="business" items={wholesaleList} onAll={() => { changeMode("business"); go("public-products"); }} />
      <SupplierStrip items={suppliers} industries={inds} onOpen={setSupplier} />
      <TradeRow id="new-arrivals" title="New arrivals" shelf={shelf} items={newest} onAll={() => go("public-products")} />
      <TradeRow id="offers" title="Special offers" sub="Active discounts" shelf={shelf} mode="individual" items={offers} />
      <MarketShop shelf={shelf} onMode={changeMode} industries={indTabs} categories={cats} counts={counts}
        industry={effIndustry} category={effCategory} setIndustry={setIndustryId} setCategory={setCategoryId}
        search={search} setSearch={setSearch} items={shown} emptyText={emptyMessage} />

      <RfqBanner onOpen={() => setRfqOpen(true)} />
      <MarketFooter industries={headerInds} onIndustry={openIndustry} onRequest={() => setQuoteOpen(true)} signedIn={!!session} onAccount={() => navigate(session ? "/admin" : "/login")} />

      {cart.length > 0 && !quoteOpen && (
        <div className="hm-cartbar" role="status">
          <span aria-label={`${cart.length} ${cart.length === 1 ? "product" : "products"} in your request`}><ClipboardList size={20} /><b>{cart.length}</b></span>
          <button className="btn gold" onClick={() => setQuoteOpen(true)}>Send <ArrowRight size={15} /></button>
        </div>
      )}
      {rfqOpen && <RfqModal products={products} industries={mInds} categories={cats} catOf={p => catById.get(catKey(p))} onClose={() => setRfqOpen(false)} />}
      <BottomNav wishCount={wishCount} requestCount={cart.length} onHome={() => go("top")} onCategories={() => setMenuOpen(true)} onSearch={() => { go("top"); window.setTimeout(() => searchRef.current?.focus(), 300); }} onWishlist={() => setWishOpen(true)} onRequest={() => setQuoteOpen(true)} />
      <FloatingContact />
      {supplier && <SupplierDialog s={supplier} industries={inds} cats={supCatNames(supplier.id)} onClose={() => setSupplier(null)} />}
      {quick && <ProductDialog p={quick} shelf={shelf} onClose={() => setQuick(null)} onStore={() => setQuick(null)} />}
      {wishOpen && <WishlistDrawer items={wishItems} shelf={shelf} onClose={() => setWishOpen(false)} />}
      {quoteOpen && <RequestModal products={products} mode={mode} onMode={changeMode} initial={cart} onLines={setCart} onClose={() => setQuoteOpen(false)} onSent={() => setCart([])} />}
    </div>
  );
}
