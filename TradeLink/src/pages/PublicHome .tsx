import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, Check, ChevronRight, ClipboardList, Cuboid, Droplet, Headset, Package,
  Menu, ShieldCheck, ShoppingCart, Truck, Users, Wheat, X,
} from "lucide-react";
import { Brand } from "../components/Brand";
import { ContactCards, ContactIcons, FloatingContact, hasContact } from "../components/ContactActions";
import { ProductShowcase } from "../components/ProductShowcase";
import { oilImg, riceImg, sugarImg, warehouseImg } from "../lib/assets";
import { supabase, type Product } from "../lib/supabase";

const CATEGORIES = ["Rice", "Sugar", "Cooking Oil"];
const NAV = [
  { id: "top", label: "Home" },
  { id: "public-products", label: "Products" },
  { id: "why", label: "About Us" },
  { id: "contact", label: "Contact" },
];
const categoryImages = [riceImg, sugarImg, oilImg];
type Status = "loading" | "ready" | "error" | "offline";

function QuoteModal({ products, initialProduct, onClose }: { products: Product[]; initialProduct: string; onClose: () => void }) {
  const [productName, setProductName] = useState(initialProduct);
  const [unit, setUnit] = useState(() => products.find(p => p.name === initialProduct)?.unit ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quoteNumber, setQuoteNumber] = useState("");

  const pickProduct = (name: string) => {
    setProductName(name);
    setUnit(products.find(p => p.name === name)?.unit ?? "");
  };
  const chosen = products.find(p => p.name === productName);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!supabase) { setError("This website is not connected to its database yet. Please contact us by phone."); return; }
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    const { data, error: rpcError } = await supabase.rpc("submit_quote", {
      p_name: String(f.get("name") ?? ""),
      p_phone: String(f.get("phone") ?? ""),
      p_email: String(f.get("email") ?? ""),
      p_location: String(f.get("location") ?? ""),
      p_product: productName,
      p_quantity: Number(f.get("quantity")),
      p_unit: unit,
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
            <small className="kicker">TRADELINK · WHOLESALE ENQUIRY</small>
            <h2>Request a Wholesale Quote</h2>
            <p>Tell us what products and quantities your business needs.</p>
            <form className="form-grid" onSubmit={submit}>
              <label>Business / contact name<input name="name" required maxLength={120} placeholder="Your name or business" /></label>
              <label>Phone / WhatsApp<input name="phone" required maxLength={30} placeholder="+251 ..." /></label>
              <label>Email (optional)<input name="email" type="email" maxLength={160} placeholder="name@business.com" /></label>
              <label>Product
                <select value={productName} required onChange={e => pickProduct(e.target.value)}>
                  <option value="">Select product</option>
                  {products.map(p => <option key={p.id}>{p.name}</option>)}
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
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<Status>(supabase ? "loading" : "offline");
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [selected, setSelected] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("top");

  // Smooth-scroll to a section, leaving room for the sticky header.
  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const header = document.querySelector<HTMLElement>(".public-header")?.offsetHeight ?? 80;
    const y = id === "top" ? 0 : el.getBoundingClientRect().top + window.scrollY - header + 1;
    window.scrollTo({ top: y, behavior: reduce ? "auto" : "smooth" });
    history.replaceState(null, "", `#${id}`);
    setMenuOpen(false);
  }, []);

  // Highlight the section currently on screen.
  useEffect(() => {
    const ids = NAV.map(n => n.id);
    const onScroll = () => {
      const header = document.querySelector<HTMLElement>(".public-header")?.offsetHeight ?? 80;
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
    supabase.from("products").select("*").eq("active", true).order("name")
      .then(({ data, error }) => {
        if (error) { setStatus("error"); return; }
        setProducts((data ?? []) as Product[]);
        setStatus("ready");
      });
  }, []);

  const openQuote = (name = "") => { setSelected(name); setQuoteOpen(true); };
  const categories = CATEGORIES.map((cat, i) => ({ cat, i, product: products.find(x => x.category === cat) })).filter(c => c.product);
  const emptyMessage =
    status === "loading" ? "Loading our products…"
    : status === "offline" ? "The product catalogue is not connected yet."
    : status === "error" ? "We could not load the product list. Please refresh the page."
    : "Our wholesale product list is being updated. Please check back soon or contact us.";

  return (
    <div className="public-site">
      <header className="public-header">
        <a href="#top" className="brand-link" onClick={e => { e.preventDefault(); go("top"); }}><Brand /></a>
        <nav aria-label="Main">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} className={active === n.id ? "active" : ""} aria-current={active === n.id ? "true" : undefined}
               onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>
          ))}
        </nav>
        <button className="btn gold" onClick={() => openQuote()}><ClipboardList size={17} /> Request a Quote</button>
        <button className="admin-link" onClick={() => navigate("/login")}>Staff Login</button>
        <button className="menu-btn" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>
      {menuOpen && (
        <div className="mobile-panel" role="menu">
          {NAV.map(n => (
            <a key={n.id} href={`#${n.id}`} role="menuitem" className={active === n.id ? "active" : ""} onClick={e => { e.preventDefault(); go(n.id); }}>{n.label}</a>
          ))}
          <a href="/login" role="menuitem" onClick={e => { e.preventDefault(); navigate("/login"); }}>Staff Login</a>
        </div>
      )}

      <section className="public-hero" id="top" style={{ backgroundImage: `linear-gradient(90deg,rgba(2,48,46,.96),rgba(4,75,67,.78) 44%,rgba(4,69,62,.1)),url(${warehouseImg})` }}>
        <div className="hero-copy">
          <div className="eyebrow"><i /> QUALITY · TRUST · PARTNERSHIP <i /></div>
          <h1>Your Trusted Partner in <em>Food Wholesale.</em></h1>
          <p>Bulk food products at competitive prices.<br />Reliable supply for your business.</p>
          <button className="btn gold hero-cta" onClick={() => openQuote()}><ClipboardList size={18} /> Request Wholesale Quote <ArrowRight size={18} /></button>
        </div>
        <div className="hero-bottom-note"><Package size={17} /> Bulk supply for retailers, distributors and businesses</div>
      </section>

      <section className="public-section" id="public-products">
        <div className="section-title"><i /><div><h2>Our Products – Large Quantity Orders</h2><p>Essential food products for your business</p></div><i /></div>
        <div className="category-grid">
          {categories.length === 0 && <p className="inline-note">{emptyMessage}</p>}
          {categories.map(({ cat, i, product: p }) => {
            if (!p) return null;
            return (
              <button className="category-card" key={cat} onClick={() => openQuote(p.name)}>
                <img src={p.image_url || categoryImages[i]} alt={cat} />
                <div className="category-label">
                  <span className="category-icon">{i === 0 ? <Wheat /> : i === 1 ? <Cuboid /> : <Droplet />}</span>
                  <span><b>{cat}</b><small>{i === 2 ? "Bulk supply (5L / 20L+ containers)" : "Bulk supply (25kg / 50kg+ bags)"}</small></span>
                  <span className="circle-arrow"><ChevronRight /></span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {products.length > 0 && (
      <section className="public-section featured-section">
        <div className="section-title"><i /><div><h2>Featured Wholesale Products</h2><p>Bulk quantities · Competitive wholesale prices</p></div><i /></div>
        <div className="public-products">
          {products.slice(0, 6).map(p => (
            <article className="public-product" key={p.id}>
              <img src={p.image_url || riceImg} alt={p.name} />
              <div>
                <h3>{p.name}</h3>
                <p>{p.package_size || p.unit} · Large orders</p>
                <button className="btn green" onClick={() => openQuote(p.name)}><ShoppingCart size={15} /> Request Wholesale Price <ArrowRight size={15} /></button>
                <ContactIcons message={`Hello TradeLink, I would like a wholesale price for ${p.name}.`} />
              </div>
            </article>
          ))}
        </div>
      </section>
      )}

      <section className="public-section why-section" id="why">
        <div className="section-title"><i /><div><h2>Why TradeLink?</h2></div><i /></div>
        <div className="why-grid">
          <div><ShieldCheck /><b>Premium Quality</b><p>Trusted food products</p></div>
          <div><Users /><b>Competitive Prices</b><p>Wholesale value for bulk buyers</p></div>
          <div><Truck /><b>Reliable Supply</b><p>Organized orders and dependable delivery</p></div>
          <div><Headset /><b>Dedicated Support</b><p>Our business, our priority</p></div>
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-copy">
          <small className="kicker">TALK TO US</small>
          <h2>Order by phone, WhatsApp or Telegram</h2>
          <p>Tell us the product and quantity. We reply with a wholesale price and delivery details.</p>
          {hasContact
            ? <ContactCards />
            : <p className="inline-note">Contact numbers will appear here soon. You can still send a quote request below.</p>}
          <button className="btn green" onClick={() => openQuote()}><ClipboardList size={17} /> Or send a quote request <ArrowRight size={17} /></button>
        </div>
        <ProductShowcase products={products} onQuote={openQuote} />
      </section>

      <section className="quote-banner">
        <Package />
        <div><h2>Need a Large Order?</h2><p>Tell us what you need. We’ll provide a wholesale quotation.</p></div>
        <button className="btn gold" onClick={() => openQuote()}><ClipboardList /> Request a Wholesale Quote <ArrowRight /></button>
      </section>

      <footer className="public-footer">
        <Brand light /><p>Growing Together. Supplying Better.</p>
        <div className="footer-social"><span>f</span><span>➤</span><span>◔</span></div>
        <small>© {new Date().getFullYear()} TradeLink. All rights reserved.</small>
      </footer>

      <FloatingContact />
      {quoteOpen && <QuoteModal products={products} initialProduct={selected} onClose={() => setQuoteOpen(false)} />}
    </div>
  );
}
