import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Search, Shirt, SlidersHorizontal, X } from "lucide-react";
import { ContactRow } from "../../components/ContactActions";
import { priceOf, useFashion } from "./store";
import { ProductGrid, useReveal } from "./parts";

const delay = (i: number) => ({ "--i": i } as CSSProperties);
const HERO_IMG = "/img/fashion-hero.jpg";

function Section({ id, eyebrow, title, action, children }: { id?: string; eyebrow: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="fx-section" id={id}>
      <div className="fx-head" data-rv="">
        <div><small>{eyebrow}</small><h2>{title}</h2></div>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ hero */
export function Hero() {
  const f = useFashion();
  const [photo, setPhoto] = useState(true); // the owner's own hero photo (public/img/fashion-hero.jpg), if it exists
  const collage = f.products.map(p => f.photos(p)[0]).filter(Boolean).slice(0, 3);
  return (
    <section className={`fx-hero ${photo ? "has-photo" : "no-photo"}`} id="top">
      {photo && <img className="fx-hero-img" src={HERO_IMG} alt="" onError={() => setPhoto(false)} />}
      {photo && <div className="fx-hero-shade" />}
      {!photo && collage.length > 0 && (
        <div className="fx-hero-collage" aria-hidden="true">
          {collage.map((u, i) => <img key={u} src={u} alt="" style={delay(i)} loading="eager" decoding="async" />)}
        </div>
      )}
      <div className="fx-hero-copy">
        <small className="fx-rise" style={delay(0)}>TradeLink Fashion</small>
        <h1 className="fx-rise" style={delay(1)}>{f.industry?.name ?? "Clothing"}</h1>
        {f.industry?.description && <p className="fx-rise" style={delay(2)}>{f.industry.description}</p>}
        <div className="fx-hero-cta fx-rise" style={delay(3)}>
          <Link className="fx-btn light" to="/clothing#catalogue">Shop Collection <ArrowRight size={18} /></Link>
          <Link className="fx-btn ghost" to="/clothing#new">New Arrivals</Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ shop by category */
export function Categories() {
  const f = useFashion();
  useReveal(f.categories.length);
  const cards = f.categories.map(c => {
    const items = f.products.filter(p => p.category_id === c.id);
    return { c, count: items.length, img: c.image_url || items.map(p => f.photos(p)[0]).find(Boolean) || null };
  }).filter(x => x.count > 0);
  if (!cards.length) return null;
  return (
    <Section eyebrow="Collections" title="Shop by Category">
      <div className="fx-cats">
        {cards.map(({ c, count, img }, i) => (
          <Link key={c.id} to={`/clothing?cat=${c.id}#catalogue`} className="fx-cat" data-rv="" style={delay(i % 3)}>
            {img ? <img src={img} alt="" loading="lazy" decoding="async" /> : <span className="fx-ph"><Shirt size={42} /></span>}
            <span className="fx-cat-shade" />
            <span className="fx-cat-label"><span><b>{c.name}</b><small>{count} {count === 1 ? "item" : "items"}</small></span><i><ArrowUpRight size={18} /></i></span>
          </Link>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ new arrivals / best sellers */
export function NewArrivals() {
  const f = useFashion();
  const items = [...f.products].sort((a, b) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0)).slice(0, 8);
  if (!items.length) return null;
  return (
    <Section id="new" eyebrow="Just in" title="New Arrivals" action={<Link className="fx-viewall" to="/clothing?sort=new#catalogue">View all <ArrowRight size={16} /></Link>}>
      <ProductGrid items={items} />
    </Section>
  );
}

/** Ranked from real recorded sales; the section stays hidden until something has sold. */
export function BestSellers() {
  const f = useFashion();
  const items = f.bestIds.map(id => f.byId.get(id)).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 4);
  if (!items.length) return null;
  return (
    <Section id="best" eyebrow="Most loved" title="Best Sellers">
      <ProductGrid items={items} />
    </Section>
  );
}

/* ------------------------------------------------------------------ sale banner */
/** Shown only while real products carry a sale price; there is no made-up campaign. */
export function Promo() {
  const f = useFashion();
  const onSale = f.products.filter(p => priceOf(p).onSale);
  if (!onSale.length) return null;
  const imgs = onSale.map(p => f.photos(p)[0]).filter(Boolean).slice(0, 2);
  return (
    <section className="fx-promo" data-rv="">
      <div className="fx-promo-copy">
        <small>Now on sale</small>
        <h2>{onSale.length} {onSale.length === 1 ? "style" : "styles"}, new prices</h2>
        <Link className="fx-btn dark" to="/clothing?sale=1#catalogue">Shop the sale <ArrowRight size={18} /></Link>
      </div>
      <div className="fx-promo-art" aria-hidden="true">
        {imgs.map((u, i) => <img key={u} src={u} alt="" loading="lazy" decoding="async" style={delay(i)} />)}
        {!imgs.length && <span className="fx-ph"><Shirt size={46} /></span>}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ full catalogue: filters, search, sort */
const SORTS = [
  { id: "new", label: "Newest" },
  { id: "low", label: "Price: low to high" },
  { id: "high", label: "Price: high to low" },
  { id: "az", label: "Name: A to Z" },
];
const PAGE = 12;

export function Catalogue() {
  const f = useFashion();
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat") ?? "all";
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "new";
  const saleOnly = params.get("sale") === "1";
  const [limit, setLimit] = useState(PAGE);
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "" || v === "all") next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true, preventScrollReset: true });
  };
  useEffect(() => { setLimit(PAGE); }, [cat, q, sort, saleOnly]);

  const cats = f.categories.filter(c => f.products.some(p => p.category_id === c.id));
  const hasSale = f.products.some(p => priceOf(p).onSale);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = f.products.filter(p =>
      (cat === "all" || p.category_id === cat) &&
      (!saleOnly || priceOf(p).onSale) &&
      (!term || `${p.name} ${p.brand ?? ""} ${f.catName(p)} ${p.description ?? ""}`.toLowerCase().includes(term)));
    const price = (p: typeof list[number]) => priceOf(p).now ?? Number.POSITIVE_INFINITY;
    const by = {
      new: (a: typeof list[number], b: typeof list[number]) => +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0),
      low: (a: typeof list[number], b: typeof list[number]) => price(a) - price(b),
      high: (a: typeof list[number], b: typeof list[number]) => (price(b) === Infinity ? -1 : price(a) === Infinity ? 1 : price(b) - price(a)),
      az: (a: typeof list[number], b: typeof list[number]) => a.name.localeCompare(b.name),
    }[sort] ?? (() => 0);
    return [...list].sort(by);
  }, [f, cat, q, sort, saleOnly]);

  const shown = rows.slice(0, limit);
  const filtered = cat !== "all" || !!q || saleOnly;
  const title = cat !== "all" ? (f.categories.find(c => c.id === cat)?.name ?? "Catalogue") : "The Collection";

  return (
    <Section id="catalogue" eyebrow="Browse" title={title}>
      <div className="fx-bar" data-rv="">
        <div className="fx-chips" role="group" aria-label="Category">
          <button className={cat === "all" && !saleOnly ? "on" : ""} onClick={() => set({ cat: null, sale: null })}>All</button>
          {cats.map(c => <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => set({ cat: c.id })}>{c.name}</button>)}
          {hasSale && <button className={saleOnly ? "on sale" : "sale"} onClick={() => set({ sale: saleOnly ? null : "1" })}>Sale</button>}
        </div>
        <div className="fx-tools">
          <label className="fx-find"><Search size={17} />
            <input value={q} onChange={e => set({ q: e.target.value })} placeholder="Search" aria-label="Search the collection" />
            {q && <button type="button" aria-label="Clear search" onClick={() => set({ q: null })}><X size={15} /></button>}
          </label>
          <label className="fx-sort"><SlidersHorizontal size={16} />
            <select value={sort} onChange={e => set({ sort: e.target.value })} aria-label="Sort by">{SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
          </label>
        </div>
      </div>
      <p className="fx-count" aria-live="polite">{rows.length} {rows.length === 1 ? "piece" : "pieces"}{filtered && <button onClick={() => set({ cat: null, q: null, sale: null })}>Clear filters <X size={13} /></button>}</p>
      {rows.length === 0
        ? <div className="fx-empty"><Shirt size={34} /><p>Nothing matches your filters</p></div>
        : <ProductGrid items={shown} />}
      {rows.length > limit && <div className="fx-center"><button className="fx-btn line" onClick={() => setLimit(l => l + PAGE)}>Show more</button></div>}
    </Section>
  );
}

/* ------------------------------------------------------------------ footer */
export function Footer() {
  const f = useFashion();
  const cats = f.categories.filter(c => f.products.some(p => p.category_id === c.id));
  return (
    <footer className="fx-footer">
      <div className="fx-footer-in">
        <div><Link to="/clothing" className="fx-logo">TradeLink<span>Fashion</span></Link><ContactRow /></div>
        <nav aria-label="Footer">
          <Link to="/clothing#new">New Arrivals</Link>
          {cats.map(c => <Link key={c.id} to={`/clothing?cat=${c.id}#catalogue`}>{c.name}</Link>)}
          <Link to="/">TradeLink home</Link>
        </nav>
      </div>
      <small>© {new Date().getFullYear()} TradeLink</small>
    </footer>
  );
}
