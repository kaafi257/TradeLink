import { useCallback, useEffect, useState, type FormEvent } from "react";
import { TURNSTILE_SITE_KEY, Turnstile } from "../components/Turnstile";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, ClipboardList, Headphones, Menu, Phone, ShieldCheck, Tag, Truck, X } from "lucide-react";
import { Brand } from "../components/Brand";
import { ContactCards, ContactPills, FloatingContact } from "../components/ContactActions";
import { useChannels, useContact } from "../lib/contact";
import { oilImg, riceImg, sugarImg } from "../lib/assets";
import { supabase, type PublicProduct } from "../lib/supabase";
import "./home.css";

const CATEGORIES = ["Rice", "Sugar", "Cooking Oil"];
const NAV = [
  { id: "top", label: "Home" },
  { id: "public-products", label: "Products" },
  { id: "why", label: "About Us" },
  { id: "contact", label: "Contact" },
];
const TAGS = [
  { cat: "Rice", size: "25kg and 50kg+ bags" },
  { cat: "Sugar", size: "25kg and 50kg+ bags" },
  { cat: "Cooking Oil", size: "5L and 20L+ containers" },
];
const FEATURED = [
  { cat: "Rice", title: "Rice", size: "25kg and 50kg bags", img: "/img/rice.jpg", cls: "rice", alt: "Stacked 50kg sacks of basmati rice on wooden pallets" },
  { cat: "Sugar", title: "Sugar", size: "25kg and 50kg+ bags", img: "/img/sugar.jpg", cls: "sugar", alt: "Two 50kg sacks of refined cane sugar beside open sacks of lentils and chickpeas" },
  { cat: "Cooking Oil", title: "Cooking oil", size: "5L and 20L+ containers", img: "/img/oil.jpg", cls: "oil", alt: "Stacked 20 litre jerrycans and cartons of cooking oil in a warehouse" },
];
const ROUTE = ["Shipped in bulk", "Cleared at the port", "Stored and ready", "Delivered to you"];
const POINTS = [
  { Icon: ShieldCheck, title: "Quality you can trust", text: "Sealed bulk packaging." },
  { Icon: Tag, title: "Wholesale pricing", text: "Priced per order." },
  { Icon: Truck, title: "Reliable supply", text: "Dependable delivery." },
  { Icon: Headphones, title: "A real person to talk to", text: "No account needed." },
];
const imageFor = (p: PublicProduct) => p.image_url || (p.category === "Sugar" ? sugarImg : p.category === "Cooking Oil" ? oilImg : riceImg);
const rank = (c: string) => { const i = CATEGORIES.indexOf(c); return i < 0 ? 99 : i; };
type Status = "loading" | "ready" | "error" | "offline";

const productLabel = (p: PublicProduct) => (p.package_size ? `${p.name} — ${p.package_size}` : p.name);

function QuoteModal({ products, initialProduct, onClose }: { products: PublicProduct[]; initialProduct: string; onClose: () => void }) {
  // The product is identified by id, because two products can share a name (e.g. 25kg and 50kg bags).
  const [productId, setProductId] = useState(initialProduct);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("");
  const [token, setToken] = useState("");
  const onToken = useCallback((t: string) => setToken(t), []);

  const chosen = products.find(p => p.id === productId);
  const unit = chosen?.unit ?? "";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!productId) { setError("Please choose a product."); return; }
    if (!supabase) { setError("This website is not connected to its database yet. Please contact us by phone."); return; }
    const f = new FormData(e.currentTarget);
    const fields = {
      name: String(f.get("name") ?? ""),
      phone: String(f.get("phone") ?? ""),
      email: String(f.get("email") ?? ""),
      location: String(f.get("location") ?? ""),
      quantity: Number(f.get("quantity")),
      notes: String(f.get("notes") ?? ""),
      website: String(f.get("website") ?? ""), // hidden honeypot field
    };
    if (TURNSTILE_SITE_KEY && !token) { setError("Please complete the security check."); return; }
    setBusy(true); setError("");
    let data: unknown; let failure = "";
    if (TURNSTILE_SITE_KEY) {
      // CAPTCHA on: the Edge Function checks the token, then submits the quote.
      const res = await supabase.functions.invoke("submit-quote", { body: { ...fields, product_id: productId, token } });
      if (res.error) {
        let msg = res.error.message;
        try { const body = await (res.error as { context?: Response }).context?.json(); if (body?.error) msg = body.error; } catch { /* keep generic message */ }
        failure = msg;
      } else if (res.data?.error) failure = String(res.data.error);
      else data = res.data?.quote_number;
    } else {
      const { data: d, error: rpcError } = await supabase.rpc("submit_quote", {
        p_name: fields.name, p_phone: fields.phone, p_email: fields.email, p_location: fields.location,
        p_product_id: productId, p_quantity: fields.quantity, p_notes: fields.notes, p_website: fields.website,
      });
      if (rpcError) failure = rpcError.message; else data = d;
    }
    setBusy(false);
    if (failure) { setError(failure); return; }
    setQuoteNumber(String(data ?? ""));
  };

  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal quote-modal" role="dialog" aria-modal="true" aria-label="Request a wholesale quote">
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        {quoteNumber ? (
          <div className="success-state">
            <Check size={48} /><h2>Quote request received</h2>
            <p>Thank you. Your reference is <b>{quoteNumber}</b>. The TradeLink team will contact you about your wholesale enquiry.</p>
            <ContactPills title="Want a faster reply? Message us with your reference" message={`Hello TradeLink, my quote reference is ${quoteNumber}.`} />
            <button className="btn green" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <small className="kicker">Wholesale enquiry</small>
            <h2>Request a Wholesale Quote</h2>
            <p>Tell us what products and quantities your business needs.</p>
            <form className="form-grid" onSubmit={submit}>
              <label>Business / contact name<input name="name" required maxLength={120} placeholder="Your name or business" /></label>
              <label>Phone / WhatsApp<input name="phone" required maxLength={30} placeholder="+251 ..." /></label>
              <label>Email (optional)<input name="email" type="email" maxLength={160} placeholder="name@business.com" /></label>
              <label>Product
                <select value={productId} required onChange={e => setProductId(e.target.value)}>
                  <option value="">Select product</option>
                  {products.map(p => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
                </select>
              </label>
              <label>Required quantity<input name="quantity" type="number" required min={chosen ? Number(chosen.min_order_quantity) : 1} step="any" placeholder={chosen ? `Minimum ${Number(chosen.min_order_quantity)}` : "e.g. 200"} /></label>
              <label>Unit<input value={unit || "Choose a product first"} readOnly disabled aria-label="Unit" /></label>
              <label>Delivery location<input name="location" required maxLength={120} placeholder="City / town" /></label>
              <label className="full">Additional details<textarea name="notes" rows={3} maxLength={1000} placeholder="Package size, timing or other requirements" /></label>
              {/* Honeypot: hidden from people, filled by bots. */}
              <div className="honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
              {TURNSTILE_SITE_KEY && <Turnstile onToken={onToken} />}
              {error && <p className="form-error full" role="alert">{error}</p>}
              {products.length === 0 && <p className="form-error full" role="alert">No products are available to order right now. Please check back soon.</p>}
              <button className="btn green full" type="submit" disabled={busy || products.length === 0}>{busy ? "Sending…" : "Send Wholesale Enquiry"} <ArrowRight /></button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function PublicHome() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [status, setStatus] = useState<Status>(supabase ? "loading" : "offline");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("top");
  const [filter, setFilter] = useState("All");
  const [solid, setSolid] = useState(false);

  // Smooth-scroll to a section, leaving room for the sticky header.
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

  // Highlight the section currently on screen.
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

  // Open the right section if the page is loaded with a #hash.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id) window.setTimeout(() => go(id), 300);
  }, [go]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("public_products").select("*").order("name")
      .then(({ data, error }) => {
        if (error) { setStatus("error"); return; }
        setProducts((data ?? []) as PublicProduct[]);
        setStatus("ready");
      });
  }, []);

  const openQuote = (productId = "") => { setSelected(productId); setQuoteOpen(true); };
  const cats = ["All", ...Array.from(new Set(products.map(p => p.category))).sort((a, b) => rank(a) - rank(b))];
  const current = cats.includes(filter) ? filter : "All";
  const shown = current === "All" ? products : products.filter(p => p.category === current);
  const contact = useContact();
  const reach = useChannels();
  const emptyMessage =
    status === "loading" ? "Loading our products…"
    : status === "offline" ? "The product catalogue is not connected yet."
    : status === "error" ? "We could not load the product list. Please refresh the page."
    : "Our wholesale product list is being updated. Please check back soon or contact us.";

  return (
    <div className="public-site">
      <header className={`hm-header${solid || menuOpen ? " solid" : ""}`}>
        <a href="#top" className="brand-link" onClick={e => { e.preventDefault(); go("top"); }}><Brand light /></a>
        <nav aria-label="Main">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} className={active === n.id ? "active" : ""} aria-current={active === n.id ? "true" : undefined}
               onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>
          ))}
        </nav>
        {contact.phone && <a className="hm-tel" href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`}><Phone size={16} /> {contact.phone}</a>}
        <button className="btn gold hm-quote" onClick={() => openQuote()}>Request a quote</button>
        <button className="hm-staff" onClick={() => navigate("/login")}>Staff login</button>
        <button className="hm-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      {menuOpen && (
        <div className="hm-mobile" role="menu">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} role="menuitem" className={active === n.id ? "active" : ""} onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>
          ))}
          <a href="/login" role="menuitem" onClick={e => { e.preventDefault(); navigate("/login"); }}>Staff login</a>
        </div>
      )}

      <section className="hm-hero" id="top">
        <img className="hm-hero-bg" src="/img/warehouse.jpg" alt="Racks and pallets stacked with sacks of rice, flour and cooking oil inside the TradeLink warehouse" />
        <div className="hm-hero-shade" />
        <div className="hm-hero-copy">
          <h1>Bulk rice, sugar and cooking oil, delivered to your business</h1>
          <p className="lead">Tell us what you need. An agent replies with a price.</p>
          <div className="hm-actions">
            <button className="btn gold hm-big" onClick={() => openQuote()}><ClipboardList size={18} /> Request a wholesale quote</button>
            <button className="btn ghost hm-big" onClick={() => go("public-products")}>See products</button>
          </div>
          {reach.length > 0 && <div className="hm-reach"><span>Talk to us now:</span><ContactPills /></div>}
          <div className="hm-tags" role="group" aria-label="Start a quote for a product">
            {TAGS.map(t => (
              <button key={t.cat} className="hm-tag" onClick={() => openQuote(products.find(p => p.category === t.cat)?.id ?? "")}>
                <b>{t.cat}</b><small>{t.size}</small>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="hm-route" aria-labelledby="route-title">
        <img className="hm-scene" src="/img/port-scene.svg" alt="Illustration of a container ship unloading at a port crane, with a truck loaded with sacks driving past the warehouse" />
        <div className="hm-route-body">
          <h2 id="route-title">From the port to your door</h2>
          <ol className="hm-route-steps">
            {ROUTE.map(r => <li key={r}><h3>{r}</h3></li>)}
          </ol>
        </div>
      </section>

      <section className="hm-section" id="public-products">
        <div className="hm-head">
          <h2>Wholesale products</h2>
          <p>Ask for today’s price.</p>
        </div>
        <div className="hm-featured">
          {FEATURED.map(f => (
            <article key={f.cat} className={`hm-feature ${f.cls}`}>
              <img src={f.img} alt={f.alt} loading="lazy" />
              <div className="hm-feature-info">
                <div><h3>{f.title}</h3><p>{f.size}</p></div>
                <button className="btn gold" onClick={() => openQuote(products.find(p => p.category === f.cat)?.id ?? "")}>Request a quote</button>
              </div>
            </article>
          ))}
        </div>
        {status === "error" && <p className="hm-empty">{emptyMessage}</p>}
        {products.length > 0 && (
          <div className="hm-catalogue">
            <div className="hm-head hm-sub">
              <h3>Available now</h3>
              <div className="hm-filters" role="group" aria-label="Filter by category">
                {cats.map(c => <button key={c} className={c === current ? "on" : ""} aria-pressed={c === current} onClick={() => setFilter(c)}>{c}</button>)}
              </div>
            </div>
            <div className="hm-grid">
              {shown.map(p => (
                <article className="hm-card" key={p.id}>
                  <img src={imageFor(p)} alt={p.name} loading="lazy" />
                  <div className="body">
                    <h3>{p.name}</h3>
                    <span className="meta">{p.package_size || p.unit}</span>
                    <span className="min">Minimum order: {Number(p.min_order_quantity)} {p.unit}</span>
                    <div className="row">
                      <button className="btn green" onClick={() => openQuote(p.id)}>Request price <ArrowRight size={15} /></button>
                    </div>
                    <ContactPills title="Or ask us directly" message={`Hello TradeLink, I would like a wholesale price for ${productLabel(p)}.`} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="hm-why" id="why">
        <div className="hm-section hm-about">
          <div><h2>Built for businesses that buy in volume</h2><p>Steady supply at wholesale prices.</p></div>
          <div className="hm-points">
            {POINTS.map(({ Icon, title, text }) => (
              <div key={title}><span className="hm-ico"><Icon size={24} /></span><h3>{title}</h3><p>{text}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="hm-contact" id="contact">
        <div className="hm-section hm-contact-grid">
          <div>
            <h2>Order by phone, WhatsApp or Telegram</h2>
            <p>No account needed.</p>
            <ol className="hm-steps">
              <li><b>Choose a product and quantity</b></li>
              <li><b>Get your price</b></li>
              <li><b>Confirm and receive delivery</b></li>
            </ol>
          </div>
          <div className="hm-contact-panel">
            {reach.length > 0
              ? <ContactCards />
              : <p className="hm-note">Contact numbers coming soon.</p>}
            <button className="btn gold hm-big" onClick={() => openQuote()}><ClipboardList size={18} /> Send a quote request</button>
          </div>
        </div>
      </section>

      <footer className="hm-footer">
        <div><Brand light /><p>Growing Together. Supplying Better.</p></div>
        <nav aria-label="Footer">{NAV.map(n => <a key={n.id} href={`#${n.id}`} onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>)}</nav>
        <div className="hm-footer-contact">
          {reach.map(c => <a key={c.key} href={c.href} {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{c.label}: {c.detail}</a>)}
          {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
          {contact.address && <span>{contact.address}</span>}
          {contact.hours && <span>{contact.hours}</span>}
          <small>© {new Date().getFullYear()} TradeLink. All rights reserved.</small>
        </div>
      </footer>

      <FloatingContact />
      {quoteOpen && <QuoteModal products={products} initialProduct={selected} onClose={() => setQuoteOpen(false)} />}
    </div>
  );
}
