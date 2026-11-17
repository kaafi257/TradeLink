import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, ChevronDown, Eye, Heart, Menu, Minus, Plus, Search, Shirt, ShoppingBag, Trash2, X } from "lucide-react";
import { ContactRow } from "../../components/ContactActions";
import { money } from "../../lib/format";
import type { PublicProduct } from "../../lib/supabase";
import { optionText, priceOf, useEscape, useFashion, useScrollLock, type CartLine } from "./store";

/** Fades and lifts anything marked data-rv as it scrolls into view. Re-scans when `dep` changes (new products rendered). */
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".fx [data-rv]:not([data-in])"));
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach(e => e.setAttribute("data-in", "")); return; }
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.setAttribute("data-in", ""); io.unobserve(e.target); } }), { threshold: 0.08, rootMargin: "0px 0px -24px 0px" });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

const catLink = (id?: string) => (id ? `/clothing?cat=${id}#catalogue` : "/clothing#catalogue");
const delay = (i: number) => ({ "--i": i } as CSSProperties);

/* ------------------------------------------------------------------ header */
export function Header({ solidAlways }: { solidAlways?: boolean }) {
  const f = useFashion();
  const [solid, setSolid] = useState(false);
  const [dd, setDd] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > 40);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const cats = f.categories.filter(c => f.products.some(p => p.category_id === c.id));
  const quick = cats.filter(c => !/^(men|women)/i.test(c.name)).slice(0, 5);
  const close = () => { setDd(false); f.openPanel(null); };

  return (
    <header className={`fx-header${solid || solidAlways ? " solid" : ""}`}>
      <button className="fx-icon fx-burger" aria-label="Open menu" onClick={() => f.openPanel("menu")}><Menu size={22} /></button>
      <Link to="/clothing" className="fx-logo" onClick={close}>TradeLink<span>Fashion</span></Link>
      <nav className="fx-nav" aria-label="Main">
        <div className={`fx-dd${dd ? " open" : ""}`} onMouseEnter={() => setDd(true)} onMouseLeave={() => setDd(false)}
             onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDd(false); }}>
          <button className="fx-link" aria-expanded={dd} aria-haspopup="true" onClick={() => setDd(o => !o)}>Clothing <ChevronDown size={14} /></button>
          <div className="fx-dd-menu">
            <Link to={catLink()} onClick={close}>All clothing</Link>
            {cats.map(c => <Link key={c.id} to={catLink(c.id)} onClick={close}>{c.name}</Link>)}
          </div>
        </div>
        <Link className="fx-link" to="/clothing#new" onClick={close}>New Arrivals</Link>
        {quick.map(c => <Link key={c.id} className="fx-link" to={catLink(c.id)} onClick={close}>{c.name}</Link>)}
      </nav>
      <div className="fx-actions">
        <button className="fx-icon" aria-label="Search" onClick={() => f.openPanel("search")}><Search size={21} /></button>
        <button className="fx-icon" aria-label={`Wishlist, ${f.wished.size} saved`} onClick={() => f.openPanel("wishlist")}>
          <Heart size={21} />{f.wished.size > 0 && <i key={f.wished.size}>{f.wished.size}</i>}
        </button>
        <button className="fx-icon" aria-label={`Cart, ${f.cart.length} items`} onClick={() => f.openPanel("cart")}>
          <ShoppingBag size={21} />{f.cart.length > 0 && <i key={f.cart.length}>{f.cart.length}</i>}
        </button>
      </div>
    </header>
  );
}

export function Drawer({ open, onClose, title, side = "right", children }: { open: boolean; onClose: () => void; title: string; side?: "left" | "right"; children: ReactNode }) {
  useScrollLock(open);
  useEscape(open, onClose);
  return (
    <>
      <div className={`fx-scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`fx-drawer ${side}${open ? " on" : ""}`} role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open}>
        <div className="fx-drawer-head"><h2>{title}</h2><button className="fx-icon" aria-label="Close" onClick={onClose}><X size={22} /></button></div>
        <div className="fx-drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function MobileMenu() {
  const f = useFashion();
  const cats = f.categories.filter(c => f.products.some(p => p.category_id === c.id));
  const close = () => f.openPanel(null);
  return (
    <Drawer open={f.panel === "menu"} onClose={close} title="Menu" side="left">
      <nav className="fx-mnav" aria-label="Menu">
        <Link to={catLink()} onClick={close}>All clothing <ArrowRight size={16} /></Link>
        <Link to="/clothing#new" onClick={close}>New Arrivals <ArrowRight size={16} /></Link>
        {cats.map(c => <Link key={c.id} to={catLink(c.id)} onClick={close}>{c.name} <ArrowRight size={16} /></Link>)}
      </nav>
      <div className="fx-mfoot"><ContactRow /><Link to="/" onClick={close}><ArrowLeft size={15} /> TradeLink home</Link></div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ small widgets */
export const Placeholder = () => <span className="fx-ph" aria-hidden="true"><Shirt size={38} /></span>;

export function Price({ p, big }: { p: PublicProduct; big?: boolean }) {
  const { now, was } = priceOf(p);
  if (now === null) return <div className={`fx-price${big ? " big" : ""}`}><span className="ask">Ask for price</span></div>;
  return <div className={`fx-price${big ? " big" : ""}`}><b>{money(now)}</b>{was !== null && <s>{money(was)}</s>}</div>;
}

export function Stock({ p }: { p: PublicProduct }) {
  if (p.stock_status === "out") return <span className="fx-stock out"><i />Sold out</span>;
  if (p.stock_status === "low") return <span className="fx-stock low"><i />{p.stock_left ? `Only ${Math.floor(Number(p.stock_left))} left` : "Few left"}</span>;
  return <span className="fx-stock in"><i />In stock</span>;
}

export function Qty({ value, onChange, max = 99 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="fx-qty" role="group" aria-label="Quantity">
      <button type="button" aria-label="Fewer" disabled={value <= 1} onClick={() => onChange(value - 1)}><Minus size={16} /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label="More" disabled={value >= max} onClick={() => onChange(value + 1)}><Plus size={16} /></button>
    </div>
  );
}

export function Heart_({ id, className = "" }: { id: string; className?: string }) {
  const f = useFashion();
  const on = f.wished.has(id);
  return (
    <button type="button" className={`fx-heart ${className}${on ? " on" : ""}`} aria-pressed={on} aria-label={on ? "Remove from wishlist" : "Add to wishlist"} onClick={() => f.toggleWish(id)}>
      <Heart size={19} />
    </button>
  );
}

/* ------------------------------------------------------------------ product card */
export function ProductCard({ p, i = 0 }: { p: PublicProduct; i?: number }) {
  const f = useFashion();
  const photos = f.photos(p);
  const { onSale } = priceOf(p);
  const to = `/clothing/${p.id}`;
  return (
    <article className="fx-card" data-rv="" style={delay(i % 4)}>
      <div className="fx-media">
        <Link to={to} aria-label={p.name} tabIndex={-1}>
          {photos[0] ? <img className="a" src={photos[0]} alt={p.name} loading="lazy" decoding="async" width={600} height={800} /> : <Placeholder />}
          {photos[1] && <img className="b" src={photos[1]} alt="" loading="lazy" decoding="async" width={600} height={800} />}
        </Link>
        {onSale && <span className="fx-badge">Sale</span>}
        {p.stock_status === "out" && <span className="fx-badge out">Sold out</span>}
        <Heart_ id={p.id} />
        <button type="button" className="fx-quick" onClick={() => f.setQuick(p)}><Eye size={16} /> Quick view</button>
      </div>
      <div className="fx-info">
        {p.brand && <small className="fx-brand">{p.brand}</small>}
        <Link className="fx-name" to={to}>{p.name}</Link>
        <Price p={p} />
      </div>
    </article>
  );
}

export function ProductGrid({ items }: { items: PublicProduct[] }) {
  useReveal(items.length + (items[0]?.id ?? ""));
  return <div className="fx-grid">{items.map((p, i) => <ProductCard key={p.id} p={p} i={i} />)}</div>;
}

/* ------------------------------------------------------------------ gallery */
export function Gallery({ photos, name, thumbs = true }: { photos: string[]; name: string; thumbs?: boolean }) {
  const [i, setI] = useState(0);
  const start = useRef<number | null>(null);
  const n = photos.length;
  useEffect(() => { setI(0); }, [photos[0]]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!n) return <div className="fx-gal"><div className="fx-gal-main"><Placeholder /></div></div>;
  const go = (d: number) => setI(x => (x + d + n) % n);
  return (
    <div className={`fx-gal${thumbs && n > 1 ? " with-thumbs" : ""}`}>
      {thumbs && n > 1 && (
        <div className="fx-thumbs">
          {photos.map((u, k) => <button key={u} type="button" className={k === i ? "on" : ""} aria-label={`Show photo ${k + 1}`} onClick={() => setI(k)}><img src={u} alt="" loading="lazy" decoding="async" /></button>)}
        </div>
      )}
      <div className="fx-gal-main" onPointerDown={e => { start.current = e.clientX; }}
           onPointerUp={e => { if (start.current !== null) { const d = e.clientX - start.current; if (Math.abs(d) > 40 && n > 1) go(d < 0 ? 1 : -1); start.current = null; } }}
           onPointerCancel={() => { start.current = null; }}>
        <img key={photos[i]} src={photos[i]} alt={`${name}, photo ${i + 1} of ${n}`} decoding="async" draggable={false} />
        {n > 1 && <>
          <button type="button" className="fx-arrow l" aria-label="Previous photo" onClick={() => go(-1)}><ArrowLeft size={18} /></button>
          <button type="button" className="fx-arrow r" aria-label="Next photo" onClick={() => go(1)}><ArrowRight size={18} /></button>
          <div className="fx-dots" aria-hidden="true">{photos.map((u, k) => <i key={u} className={k === i ? "on" : ""} />)}</div>
        </>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ size / colour / quantity / add to cart */
export function BuyBox({ p, onAdded }: { p: PublicProduct; onAdded?: () => void }) {
  const f = useFashion();
  const sizes = f.sizes(p.id);
  const colors = f.colors(p.id);
  const inCart = f.cart.find(l => l.productId === p.id);
  const [size, setSize] = useState<string | undefined>(inCart?.size);
  const [color, setColor] = useState<string | undefined>(inCart?.color);
  const [qty, setQty] = useState(inCart?.qty ?? 1);
  const [hint, setHint] = useState(false);
  const out = p.stock_status === "out";
  const max = p.stock_status === "low" && p.stock_left ? Math.max(1, Math.floor(Number(p.stock_left))) : 99;

  // Options load after the page does, so a single size or colour is picked once it arrives.
  useEffect(() => { if (!size && sizes.length === 1) setSize(sizes[0]); }, [sizes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!color && colors.length === 1) setColor(colors[0].label); }, [colors.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (qty > max) setQty(max); }, [max, qty]);

  const missing = (sizes.length > 0 && !size) || (colors.length > 0 && !color);
  const add = () => {
    if (missing) { setHint(true); return; }
    f.addToCart({ productId: p.id, qty, size, color });
    setHint(false);
    onAdded?.();
    f.openPanel("cart");
  };

  return (
    <div className="fx-buy">
      {sizes.length > 0 && (
        <div className={`fx-opt${hint && !size ? " need" : ""}`}>
          <div className="fx-opt-h"><b>Size</b><span>{size ?? (hint ? "Please choose a size" : "")}</span></div>
          <div className="fx-sizes" role="radiogroup" aria-label="Size">
            {sizes.map(s => <button key={s} type="button" role="radio" aria-checked={size === s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s}</button>)}
          </div>
        </div>
      )}
      {colors.length > 0 && (
        <div className={`fx-opt${hint && !color ? " need" : ""}`}>
          <div className="fx-opt-h"><b>Colour</b><span>{color ?? (hint ? "Please choose a colour" : "")}</span></div>
          <div className="fx-colors" role="radiogroup" aria-label="Colour">
            {colors.map(c => <button key={c.label} type="button" role="radio" aria-checked={color === c.label} aria-label={c.label} title={c.label} className={color === c.label ? "on" : ""} onClick={() => setColor(c.label)}><i style={{ background: c.hex }} /></button>)}
          </div>
        </div>
      )}
      <div className="fx-buy-row">
        <Qty value={qty} onChange={setQty} max={max} />
        <Stock p={p} />
      </div>
      <div className="fx-buy-actions">
        <button type="button" className="fx-btn dark" disabled={out} onClick={add}>
          <ShoppingBag size={18} /> {out ? "Sold out" : inCart ? "Update cart" : "Add to cart"}
        </button>
        <Heart_ id={p.id} className="big" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ quick view */
export function QuickView() {
  const f = useFashion();
  const p = f.quick;
  const close = () => f.setQuick(null);
  useScrollLock(!!p);
  useEscape(!!p, close);
  if (!p) return null;
  return (
    <div className="fx-modal-back" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="fx-modal" role="dialog" aria-modal="true" aria-label={p.name}>
        <button className="fx-icon fx-modal-x" aria-label="Close" onClick={close}><X size={22} /></button>
        <Gallery photos={f.photos(p)} name={p.name} thumbs={false} />
        <div className="fx-modal-info">
          {p.brand && <small className="fx-brand">{p.brand}</small>}
          <h2>{p.name}</h2>
          <Price p={p} big />
          {p.description && <p className="fx-desc clamp">{p.description}</p>}
          <BuyBox p={p} onAdded={close} />
          <Link className="fx-more" to={`/clothing/${p.id}`} onClick={close}>View full details <ArrowRight size={16} /></Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ cart, wishlist, search */
export function CartDrawer() {
  const f = useFashion();
  const close = () => f.openPanel(null);
  const lines = f.cart.map(l => ({ l, p: f.byId.get(l.productId) })).filter((x): x is { l: CartLine; p: PublicProduct } => !!x.p);
  const total = lines.reduce((s, { l, p }) => s + (priceOf(p).now ?? 0) * l.qty, 0);
  const complete = lines.length > 0 && lines.every(({ p }) => priceOf(p).now !== null);
  return (
    <Drawer open={f.panel === "cart"} onClose={close} title="Cart">
      {lines.length === 0 ? (
        <div className="fx-empty"><ShoppingBag size={34} /><p>Your cart is empty</p><Link className="fx-btn line" to={catLink()} onClick={close}>Browse clothing</Link></div>
      ) : (
        <>
          <ul className="fx-lines">
            {lines.map(({ l, p }) => {
              const photo = f.photos(p)[0];
              const opt = optionText(l);
              return (
                <li key={p.id}>
                  <Link to={`/clothing/${p.id}`} className="fx-lthumb" onClick={close}>{photo ? <img src={photo} alt="" loading="lazy" /> : <Placeholder />}</Link>
                  <div>
                    <Link to={`/clothing/${p.id}`} className="fx-lname" onClick={close}>{p.name}</Link>
                    {opt && <small>{opt}</small>}
                    <Qty value={l.qty} onChange={n => f.setQty(p.id, n)} max={p.stock_status === "low" && p.stock_left ? Math.max(1, Math.floor(Number(p.stock_left))) : 99} />
                  </div>
                  <div className="fx-lright">
                    <b>{priceOf(p).now !== null ? money(priceOf(p).now! * l.qty) : "Ask"}</b>
                    <button className="fx-icon" aria-label={`Remove ${p.name}`} onClick={() => f.removeFromCart(p.id)}><Trash2 size={17} /></button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="fx-cartfoot">
            {total > 0 && <div className="fx-total"><span>Estimated total</span><b>{money(total)}{!complete && "+"}</b></div>}
            <button className="fx-btn dark wide" onClick={() => { close(); f.setRequestOpen(true); }}>Send request <ArrowRight size={18} /></button>
            <div className="fx-center"><ContactRow /></div>
          </div>
        </>
      )}
    </Drawer>
  );
}

export function WishlistDrawer() {
  const f = useFashion();
  const close = () => f.openPanel(null);
  const items = f.products.filter(p => f.wished.has(p.id));
  return (
    <Drawer open={f.panel === "wishlist"} onClose={close} title="Wishlist">
      {items.length === 0 ? (
        <div className="fx-empty"><Heart size={34} /><p>Nothing saved yet</p><Link className="fx-btn line" to={catLink()} onClick={close}>Browse clothing</Link></div>
      ) : (
        <ul className="fx-lines">
          {items.map(p => {
            const photo = f.photos(p)[0];
            return (
              <li key={p.id}>
                <Link to={`/clothing/${p.id}`} className="fx-lthumb" onClick={close}>{photo ? <img src={photo} alt="" loading="lazy" /> : <Placeholder />}</Link>
                <div>
                  {p.brand && <small>{p.brand}</small>}
                  <Link to={`/clothing/${p.id}`} className="fx-lname" onClick={close}>{p.name}</Link>
                  <Price p={p} />
                </div>
                <div className="fx-lright">
                  <button className="fx-icon" aria-label={`Remove ${p.name} from wishlist`} onClick={() => f.toggleWish(p.id)}><Trash2 size={17} /></button>
                  <button className="fx-btn line sm" onClick={() => { close(); f.setQuick(p); }}>Add</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}

export function SearchPanel() {
  const f = useFashion();
  const navigate = useNavigate();
  const open = f.panel === "search";
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const close = () => f.openPanel(null);
  useEscape(open, close);
  useEffect(() => { if (open) window.setTimeout(() => ref.current?.focus(), 60); else setQ(""); }, [open]);
  const term = q.trim().toLowerCase();
  const results = term ? f.products.filter(p => `${p.name} ${p.brand ?? ""} ${f.catName(p)}`.toLowerCase().includes(term)).slice(0, 6) : [];
  const submit = (e: FormEvent) => { e.preventDefault(); if (!term) return; close(); navigate(`/clothing?q=${encodeURIComponent(q.trim())}#catalogue`); };
  return (
    <div className={`fx-search${open ? " on" : ""}`} aria-hidden={!open}>
      <div className="fx-search-in" role="dialog" aria-modal="true" aria-label="Search">
        <form onSubmit={submit}>
          <Search size={22} />
          <input ref={ref} value={q} onChange={e => setQ(e.target.value)} placeholder="Search clothing" aria-label="Search clothing" autoComplete="off" tabIndex={open ? 0 : -1} />
          <button type="button" className="fx-icon" aria-label="Close search" onClick={close} tabIndex={open ? 0 : -1}><X size={22} /></button>
        </form>
        {term && (results.length ? (
          <ul className="fx-results">
            {results.map(p => {
              const photo = f.photos(p)[0];
              return (
                <li key={p.id}>
                  <Link to={`/clothing/${p.id}`} onClick={close}>
                    <span className="fx-lthumb sm">{photo ? <img src={photo} alt="" loading="lazy" /> : <Placeholder />}</span>
                    <span><b>{p.name}</b><small>{p.brand ?? f.catName(p)}</small></span>
                    <Price p={p} />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="fx-noresult">No matches</p>)}
      </div>
      <div className="fx-search-scrim" onClick={close} aria-hidden="true" />
    </div>
  );
}
