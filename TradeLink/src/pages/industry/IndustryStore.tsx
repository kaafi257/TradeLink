import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Briefcase, Check, ClipboardList, Heart, Layers, Minus, Package, Plus, Search, ShoppingBag, Tag, User, X } from "lucide-react";
import { Brand } from "../../components/Brand";
import { ContactIcons } from "../../components/ContactActions";
import { money } from "../../lib/format";
import { IconFor } from "../../lib/icons";
import { variantFor, type StoreVariant } from "../../lib/storefront";
import { supabase, type PublicCategory, type PublicIndustry, type PublicProduct } from "../../lib/supabase";
import { lookFor } from "../../lib/theme";
import { useWishlist } from "../../lib/wishlist";
import { newKey, RequestModal, type Line, type Mode } from "../PublicHome";
import { Reveal, flyToBag, priceOf } from "../market/Market";
import "./food.css";
import "./fresh.css";
import "./build.css";
import "./tech.css";

const FONTS = "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,800&family=Public+Sans:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700;800&family=Space+Grotesk:wght@500;700&display=swap";
const MODE_KEY = "tradelink-mode";
const readMode = (): Mode => { try { return localStorage.getItem(MODE_KEY) === "individual" ? "individual" : "business"; } catch { return "business"; } };
const audienceOf = (p: PublicProduct) => p.audience ?? "both";
const allows = (p: PublicProduct, m: Mode) => audienceOf(p) === "both" || audienceOf(p) === (m === "individual" ? "b2c" : "b2b");

type Status = "loading" | "ready" | "empty" | "missing" | "offline" | "error";

/** One industry's real data from the public views (no prices beyond what the site already shows). */
function useIndustry(id: string | undefined) {
  const [state, setState] = useState<{ status: Status; industry: PublicIndustry | null; categories: PublicCategory[]; products: PublicProduct[] }>({ status: "loading", industry: null, categories: [], products: [] });
  useEffect(() => {
    if (!supabase) { setState(s => ({ ...s, status: "offline" })); return; }
    let live = true;
    (async () => {
      const [ind, cat, prod] = await Promise.all([
        supabase!.from("public_industries").select("*"),
        supabase!.from("public_categories").select("*").order("sort_order").order("name"),
        supabase!.from("public_products").select("*").order("created_at", { ascending: false }),
      ]);
      if (!live) return;
      if (ind.error || cat.error || prod.error) { setState(s => ({ ...s, status: "error" })); return; }
      const industry = ((ind.data ?? []) as PublicIndustry[]).find(i => i.id === id) ?? null;
      if (!industry) { setState({ status: "missing", industry: null, categories: [], products: [] }); return; }
      const categories = ((cat.data ?? []) as PublicCategory[]).filter(c => c.industry_id === industry.id);
      const ids = new Set(categories.map(c => c.id));
      const products = ((prod.data ?? []) as PublicProduct[]).filter(p => p.category_id && ids.has(p.category_id));
      setState({ status: products.length ? "ready" : "empty", industry, categories, products });
    })();
    return () => { live = false; };
  }, [id]);
  return state;
}

export default function IndustryStore() {
  const { id } = useParams();
  const d = useIndustry(id);
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = FONTS;
    document.head.appendChild(link);
  }, []);
  if (d.status === "missing" || (d.industry && !variantFor(d.industry.name))) return <Navigate to="/" replace />;
  return <FoodStore {...d} variant={d.industry ? variantFor(d.industry.name)! : "food"} />;
}

const sealText = (p: PublicProduct) => (p.package_size || p.unit || "").trim().split(/\s+/)[0];

function FoodStore({ status, industry, categories, products, variant }: { variant: StoreVariant; status: Status; industry: PublicIndustry | null; categories: PublicCategory[]; products: PublicProduct[] }) {
  const wish = useWishlist();
  const [mode, setModeState] = useState<Mode>(readMode);
  const [cat, setCat] = useState("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [onlySaved, setOnlySaved] = useState(false);
  const [cart, setCart] = useState<Line[]>([]);
  const [open, setOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ }
    setCart(c => c.filter(l => { const p = products.find(x => x.id === l.productId); return !p || allows(p, m); }));
  };
  useEffect(() => { if (searchOpen) searchRef.current?.focus(); }, [searchOpen]);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const iname = industry?.name ?? "";
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const looks = useMemo(() => new Map(categories.map(c => [c.id, lookFor(c.name, iname)])), [categories, iname]);
  const visible = useMemo(() => products.filter(p => allows(p, mode)), [products, mode]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => visible.filter(p =>
    (cat === "all" || p.category_id === cat) &&
    (!onlySaved || wish.has(p.id)) &&
    (!q || `${p.name} ${p.brand ?? ""} ${p.category}`.toLowerCase().includes(q))), [visible, cat, onlySaved, q, wish]);
  const counts = useMemo(() => { const m = new Map<string, number>(); for (const p of visible) if (p.category_id) m.set(p.category_id, (m.get(p.category_id) ?? 0) + 1); return m; }, [visible]);
  const shelves = useMemo(() => categories.map(c => ({ c, items: filtered.filter(p => p.category_id === c.id) })).filter(s => s.items.length > 0), [categories, filtered]);
  const savedCount = products.filter(p => wish.has(p.id)).length;
  const photos = useMemo(() => {
    const seen = new Set<string>(); const out: PublicProduct[] = [];
    for (const p of visible) if (p.image_url && !seen.has(p.category_id ?? p.id)) { seen.add(p.category_id ?? p.id); out.push(p); }
    for (const p of visible) if (p.image_url && !out.includes(p)) out.push(p);
    return out.slice(0, 3);
  }, [visible]);

  const setLine = (p: PublicProduct, qty: number) => setCart(c => c.some(l => l.productId === p.id) ? c.map(l => (l.productId === p.id ? { ...l, qty: String(qty) } : l)) : [...c, { key: newKey(), productId: p.id, qty: String(qty) }]);
  const inCart = (id: string) => cart.find(l => l.productId === id);
  const heroLook = lookFor(iname);

  return (
    <div className={`fd fd-${variant}`} style={{ "--ha": heroLook.a, "--hb": heroLook.b } as CSSProperties}>
      <header className="fd-top">
        <div className="fd-bar">
          <Link to="/" className="fd-back" aria-label="Back to TradeLink"><ArrowLeft size={19} /></Link>
          <Link to="/" className="fd-logo" aria-label="TradeLink home"><Brand /></Link>
          <div className="fd-tools">
            {searchOpen
              ? <form className="fd-search" role="search" onSubmit={e => e.preventDefault()}>
                  <Search size={17} /><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search" aria-label={`Search ${iname}`} />
                  <button type="button" aria-label="Close search" onClick={() => { setQuery(""); setSearchOpen(false); }}><X size={16} /></button>
                </form>
              : <button className="fd-ic" aria-label="Search" title="Search" onClick={() => setSearchOpen(true)}><Search size={19} /></button>}
            <div className="fd-mode" role="group" aria-label="I am shopping as">
              <i className={mode} aria-hidden="true" />
              <button aria-pressed={mode === "individual"} aria-label="Individual" title="Individual" onClick={() => setMode("individual")}><User size={17} /></button>
              <button aria-pressed={mode === "business"} aria-label="Business" title="Business" onClick={() => setMode("business")}><Briefcase size={17} /></button>
            </div>
            <button className={`fd-ic${onlySaved ? " on" : ""}`} aria-pressed={onlySaved} aria-label={`Saved products, ${savedCount}`} title="Saved" onClick={() => setOnlySaved(v => !v)}><Heart size={19} />{savedCount > 0 && <i>{savedCount}</i>}</button>
            <button className="fd-ic fd-bag" aria-label={`Price request, ${cart.length} products`} title="Price request" onClick={() => setOpen(true)}><ShoppingBag size={19} />{cart.length > 0 && <i key={cart.length}>{cart.length}</i>}</button>
          </div>
        </div>
      </header>

      <section className="fd-hero">
        <i className="fd-blob a" aria-hidden="true" /><i className="fd-blob b" aria-hidden="true" /><i className="fd-blob c" aria-hidden="true" />
        {variant === "tech" && <span className="fd-scan" aria-hidden="true" />}
        {variant === "build" && <span className="fd-stripe" aria-hidden="true" />}
        {variant === "fresh" && <span className="fd-bubbles" aria-hidden="true">{Array.from({ length: 12 }, (_, k) => <i key={k} style={{ "--k": k } as CSSProperties} />)}</span>}
        <div className="fd-wrap fd-hero-grid">
          <div className="fd-copy">
            <span className="fd-kicker"><IconFor name={industry?.icon} size={22} /></span>
            <h1>{iname || " "}</h1>
            {industry?.description && <p>{industry.description}</p>}
            <div className="fd-facts" aria-label="At a glance">
              <span title="Products"><Package size={16} />{visible.length}</span>
              <span title="Categories"><Layers size={16} />{categories.filter(c => (counts.get(c.id) ?? 0) > 0).length}</span>
              <span className="mode" title={mode === "individual" ? "Individual" : "Business"}>{mode === "individual" ? <User size={16} /> : <Briefcase size={16} />}</span>
            </div>
          </div>
          <div className="fd-collage" aria-hidden="true">
            {photos.map((p, k) => (
              <figure key={p.id} className={`fr f${k}`} style={{ "--d": `${k * -1.7}s` } as CSSProperties}>
                <img src={p.image_url!} alt="" />
                <figcaption>{mode === "individual" && priceOf(p).now ? money(priceOf(p).now!) : sealText(p)}</figcaption>
              </figure>
            ))}
            {photos.length === 0 && categories.slice(0, 4).map((c, k) => { const I = looks.get(c.id)!.Icon; return <span key={c.id} className={`ico i${k}`} style={{ "--ca": looks.get(c.id)!.a, "--ct": looks.get(c.id)!.tint } as CSSProperties}><I size={34} /></span>; })}
            <span className="orb o1"><IconFor name={industry?.icon} size={22} /></span>
            <span className="orb o2"><Package size={20} /></span>
          </div>
        </div>
      </section>

      <div className="fd-body">
      {status === "ready" && (
        <nav className="fd-aisles" aria-label="Categories">
          <div className="fd-aisles-in">
            <button className={cat === "all" ? "on" : ""} aria-pressed={cat === "all"} onClick={() => setCat("all")} style={{ "--ca": heroLook.a, "--ct": heroLook.tint, "--ci": heroLook.ink } as CSSProperties}>
              <span className="bub"><Layers size={20} /></span><b>All</b><small>{visible.length}</small>
            </button>
            {categories.filter(c => (counts.get(c.id) ?? 0) > 0).map(c => {
              const l = looks.get(c.id)!; const I = l.Icon;
              return (
                <button key={c.id} className={cat === c.id ? "on" : ""} aria-pressed={cat === c.id} onClick={() => setCat(c.id)} style={{ "--ca": l.a, "--ct": l.tint, "--ci": l.ink } as CSSProperties}>
                  <span className="bub"><I size={20} /></span><b>{c.name}</b><small>{counts.get(c.id)}</small>
                </button>
              );
            })}
          </div>
        </nav>
      )}

      <main className="fd-main">
        <div className="fd-wrap">
          {status === "loading" && <div className="fd-skel" aria-busy="true" />}
          {(status === "offline" || status === "error" || status === "empty") && (
            <div className="fd-empty" role="status"><Package size={36} /><p>{status === "offline" ? "The shop is not connected yet." : status === "error" ? "We could not load products. Please refresh." : "Products are coming soon."}</p></div>
          )}
          {status === "ready" && shelves.length === 0 && (
            <div className="fd-empty" role="status"><Search size={36} /><button onClick={() => { setQuery(""); setCat("all"); setOnlySaved(false); setSearchOpen(false); }}><X size={16} />Clear</button></div>
          )}
          {shelves.map(({ c, items }) => {
            const l = looks.get(c.id)!; const I = l.Icon;
            return (
              <Reveal key={c.id} className="fd-shelf" as="section">
                <div className="fd-shead" style={{ "--ca": l.a, "--cb": l.b, "--ct": l.tint, "--ci": l.ink } as CSSProperties}>
                  <span className="bub"><I size={20} /></span>
                  <h2>{c.name}</h2><small>{items.length}</small><i className="rule" aria-hidden="true" />
                </div>
                <div className="fd-grid">
                  {items.map(p => (
                    <FoodCard key={p.id} p={p} look={looks.get(p.category_id ?? "") ?? l} mode={mode} line={inCart(p.id)} saved={wish.has(p.id)} onSave={() => wish.toggle(p.id)}
                      onAdd={(qty, el) => { if (!inCart(p.id)) flyToBag(el, ".fd-bag"); setLine(p, qty); }} />
                  ))}
                </div>
              </Reveal>
            );
          })}
        </div>
      </main>
      </div>

      <footer className="fd-foot">
        <div className="fd-wrap fd-foot-in">
          <Link to="/" className="fd-home"><ArrowLeft size={16} /><Brand light /></Link>
          <ContactIcons />
        </div>
      </footer>

      {cart.length > 0 && !open && (
        <div className="fd-cartbar" role="status">
          <span className="bag"><ShoppingBag size={19} /><b key={cart.length}>{cart.length}</b></span>
          <button onClick={() => setOpen(true)} aria-label="Send request"><ClipboardList size={18} /><ArrowRight size={18} /></button>
        </div>
      )}
      {open && <RequestModal products={products} mode={mode} onMode={setMode} initial={cart} onLines={setCart} onClose={() => setOpen(false)} onSent={() => setCart([])} />}
    </div>
  );
}

function FoodCard({ p, look, mode, line, saved, onSave, onAdd }: {
  p: PublicProduct; look: ReturnType<typeof lookFor>; mode: Mode; line?: Line; saved: boolean; onSave: () => void; onAdd: (qty: number, el: HTMLElement) => void;
}) {
  const min = mode === "business" ? Math.max(1, Number(p.min_order_quantity) || 1) : 1;
  const [qty, setQty] = useState(() => (line ? Number(line.qty) || min : min));
  useEffect(() => { setQty(q => Math.max(min, q)); }, [min]);
  const { now, was } = priceOf(p);
  const I = look.Icon;
  const style = { "--ca": look.a, "--cb": look.b, "--ct": look.tint, "--ci": look.ink, "--cp": look.pat } as CSSProperties;
  const inBag = !!line;
  const same = inBag && Number(line!.qty) === qty;
  return (
    <article className={`fd-card${inBag ? " in" : ""}`} style={style} onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`); e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`); }}>
      <div className="fd-photo">
        {p.image_url ? <img src={p.image_url} alt={p.name} loading="lazy" /> : <span className="ph"><I size={42} /></span>}
        <span className="fd-seal" title={p.package_size || p.unit}>{sealText(p)}</span>
        <button className={`fd-heart${saved ? " on" : ""}`} aria-pressed={saved} aria-label={saved ? "Remove from saved" : "Save"} onClick={onSave}><Heart size={16} /></button>
        {p.stock_status && <span className={`fd-stock ${p.stock_status}`} role="img" aria-label={p.stock_status === "in" ? "In stock" : p.stock_status === "low" ? "Few left" : "Sold out"}><i /></span>}
      </div>
      <h3>{p.name}</h3>
      <div className="fd-meta">
        {mode === "individual" && now !== null
          ? <span className="fd-price"><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}<small>/ {p.unit}</small></span>
          : <span className="fd-price ask" title="Ask for price"><Tag size={15} /></span>}
        {mode === "business" && <span className="fd-min" title={`Minimum order ${min} ${p.unit}`}><Layers size={13} />{min}</span>}
      </div>
      <div className="fd-buy">
        <div className="fd-step" role="group" aria-label="Quantity">
          <button aria-label="Less" disabled={qty <= min} onClick={() => setQty(q => Math.max(min, q - 1))}><Minus size={15} /></button>
          <output key={qty}>{qty}</output>
          <button aria-label="More" onClick={() => setQty(q => q + 1)}><Plus size={15} /></button>
        </div>
        <button className={`fd-add${inBag ? " done" : ""}`} aria-label={same ? "In request" : inBag ? "Update quantity" : `Add ${p.name}`} title={same ? "In request" : inBag ? "Update" : "Add to request"} onClick={e => onAdd(qty, e.currentTarget)}>
          {same ? <Check size={19} /> : inBag ? <ArrowRight size={19} /> : <Plus size={19} />}
        </button>
      </div>
    </article>
  );
}
