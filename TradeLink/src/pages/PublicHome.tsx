import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, ClipboardList, Menu, Phone, X } from "lucide-react";
import { Brand } from "../components/Brand";
import { ContactCards, ContactIcons, FloatingContact, channels, hasContact } from "../components/ContactActions";
import { ProductShowcase } from "../components/ProductShowcase";
import { CONTACT } from "../config";
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

  const chosen = products.find(p => p.id === productId);
  const unit = chosen?.unit ?? "";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!productId) { setError("Please choose a product."); return; }
    if (!supabase) { setError("This website is not connected to its database yet. Please contact us by phone."); return; }
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    const { data, error: rpcError } = await supabase.rpc("submit_quote", {
      p_name: String(f.get("name") ?? ""),
      p_phone: String(f.get("phone") ?? ""),
      p_email: String(f.get("email") ?? ""),
      p_location: String(f.get("location") ?? ""),
      p_product_id: productId,
      p_quantity: Number(f.get("quantity")),
      p_notes: String(f.get("notes") ?? ""),
      p_website: String(f.get("website") ?? ""), // hidden honeypot field
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message); return; }
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
  const reach = channels();
  const emptyMessage =
    status === "loading" ? "Loading our products…"
    : status === "offline" ? "The product catalogue is not connected yet."
    : status === "error" ? "We could not load the product list. Please refresh the page."
    : "Our wholesale product list is being updated. Please check back soon or contact us.";

  return (
    <div className="public-site">
      <header className="hm-header">
        <a href="#top" className="brand-link" onClick={e => { e.preventDefault(); go("top"); }}><Brand /></a>
        <nav aria-label="Main">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} className={active === n.id ? "active" : ""} aria-current={active === n.id ? "true" : undefined}
               onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>
          ))}
        </nav>
        {CONTACT.phone && <a className="hm-tel" href={`tel:${CONTACT.phone.replace(/[^\d+]/g, "")}`}><Phone size={16} /> {CONTACT.phone}</a>}
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
        <div className="hm-hero-copy">
          <h1>Bulk rice, sugar and cooking oil for your business</h1>
          <p className="lead">Tell us the product and quantity. A TradeLink agent replies with a wholesale price and delivery details.</p>
          <div className="hm-actions">
            <button className="btn gold hm-big" onClick={() => openQuote()}><ClipboardList size={18} /> Request a wholesale quote</button>
            {reach.length > 0 && <div className="hm-reach"><span>Or message us:</span><ContactIcons /></div>}
          </div>
          <div className="hm-tags" role="group" aria-label="Start a quote for a product">
            {TAGS.map(t => (
              <button key={t.cat} className="hm-tag" onClick={() => openQuote(products.find(p => p.category === t.cat)?.id ?? "")}>
                <b>{t.cat}</b><small>{t.size}</small>
              </button>
            ))}
          </div>
        </div>
        <ProductShowcase products={products} onQuote={openQuote} />
      </section>

      <section className="hm-section" id="public-products">
        <div className="hm-head">
          <div><h2>Wholesale products</h2><p>Sold in bulk quantities. Ask for today’s price and we’ll reply with a quote.</p></div>
          {products.length > 0 && (
            <div className="hm-filters" role="group" aria-label="Filter by category">
              {cats.map(c => <button key={c} className={c === current ? "on" : ""} aria-pressed={c === current} onClick={() => setFilter(c)}>{c}</button>)}
            </div>
          )}
        </div>
        {products.length === 0 && <p className="hm-empty">{emptyMessage}</p>}
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
                  <ContactIcons message={`Hello TradeLink, I would like a wholesale price for ${productLabel(p)}.`} />
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="hm-section hm-about" id="why">
        <div><h2>Built for businesses that buy in volume</h2><p>Shops, restaurants and distributors rely on TradeLink for steady supply of everyday staples, at wholesale prices agreed for each order.</p></div>
        <div className="hm-points">
          <div><b>Quality you can trust</b><p>Trusted food products, supplied in sealed bulk packaging.</p></div>
          <div><b>Wholesale pricing</b><p>Prices are quoted per order, so bigger orders get better value.</p></div>
          <div><b>Reliable supply</b><p>Organised orders and dependable delivery to your location.</p></div>
          <div><b>A real person to talk to</b><p>Message or call an agent directly. No account needed.</p></div>
        </div>
      </section>

      <section className="hm-contact" id="contact">
        <div className="hm-section hm-contact-grid">
          <div>
            <h2>Order by phone, WhatsApp or Telegram</h2>
            <p>You don’t need to register. Contact an agent or send a quote request and we’ll reply with a price.</p>
            <ol className="hm-steps">
              <li><b>Choose a product and quantity</b><span>Use the quote form, or message us the details.</span></li>
              <li><b>An agent sends your price</b><span>You get the wholesale price and delivery details for your order.</span></li>
              <li><b>Confirm and receive delivery</b><span>Agree the order and we deliver to your location.</span></li>
            </ol>
          </div>
          <div className="hm-contact-panel">
            {hasContact
              ? <ContactCards />
              : <p className="hm-note">Contact numbers will appear here soon. You can still send a quote request.</p>}
            <button className="btn gold hm-big" onClick={() => openQuote()}><ClipboardList size={18} /> Send a quote request</button>
          </div>
        </div>
      </section>

      <footer className="hm-footer">
        <div><Brand light /><p>Growing Together. Supplying Better.</p></div>
        <nav aria-label="Footer">{NAV.map(n => <a key={n.id} href={`#${n.id}`} onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>)}</nav>
        <div className="hm-footer-contact">
          {reach.map(c => <a key={c.key} href={c.href} {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{c.label}: {c.detail}</a>)}
          <small>© {new Date().getFullYear()} TradeLink. All rights reserved.</small>
        </div>
      </footer>

      <FloatingContact />
      {quoteOpen && <QuoteModal products={products} initialProduct={selected} onClose={() => setQuoteOpen(false)} />}
    </div>
  );
}
