import { useEffect, useMemo, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { Shirt } from "lucide-react";
import { RequestModal } from "../RequestModal";
import { optionText, FashionProvider, useFashion } from "./store";
import { BestSellers, Catalogue, Categories, Footer, Hero, NewArrivals, Promo } from "./sections";
import { CartDrawer, Header, MobileMenu, QuickView, SearchPanel, WishlistDrawer, useReveal } from "./parts";
import Product from "./Product";
import "./clothing.css";

const FONTS = "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@400;500;600&display=swap";

/** Scrolls to #catalogue, #new … after a link or filter change (the router only changes the URL). */
function useHashScroll() {
  const { hash, search, key } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) el.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [hash, search, key]);
}

function Home() {
  const f = useFashion();
  useHashScroll();
  useReveal(f.status);
  if (f.status === "loading") return <main className="fx-main"><div className="fx-skel hero" aria-busy="true" /></main>;
  if (f.status !== "ready") {
    const msg = f.status === "offline" ? "The collection is not connected yet."
      : f.status === "error" ? "We could not load the collection. Please refresh the page."
      : "The collection is being prepared. Please check back soon.";
    return (
      <main className="fx-main">
        <section className="fx-hero no-photo short"><div className="fx-hero-copy"><small>TradeLink Fashion</small><h1>Coming soon</h1></div></section>
        <div className="fx-empty"><Shirt size={34} /><p>{msg}</p></div>
      </main>
    );
  }
  return (
    <main className="fx-main">
      <Hero />
      <Categories />
      <NewArrivals />
      <BestSellers />
      <Promo />
      <Catalogue />
    </main>
  );
}

/** Mounted only while the form is open, so it starts from the cart as it is at that moment. */
function RequestGate() {
  const f = useFashion();
  const [initial] = useState(() => f.cart.map(l => ({ key: l.productId, productId: l.productId, qty: String(l.qty) })));
  const extraNotes = useMemo(() => Object.fromEntries(f.cart.map(l => [l.productId, optionText(l)]).filter(([, t]) => t)), [f.cart]);
  return (
    <RequestModal
      products={f.products} mode="individual" onMode={() => undefined} lockType
      initial={initial}
      onLines={ls => f.syncCart(ls.map(l => ({ productId: l.productId, qty: Math.max(1, Math.round(Number(l.qty)) || 1) })))}
      extraNotes={extraNotes}
      onClose={() => f.setRequestOpen(false)}
      onSent={f.clearCart}
    />
  );
}

function Shell() {
  const f = useFashion();
  const { pathname } = useLocation();
  const isHome = pathname.replace(/\/$/, "") === "/clothing";

  return (
    <div className="fx">
      <a className="fx-skip" href="#fx-content">Skip to content</a>
      <Header solidAlways={!isHome || f.status !== "ready"} />
      <div id="fx-content">
        <Routes>
          <Route index element={<Home />} />
          <Route path=":id" element={<Product />} />
        </Routes>
      </div>
      <Footer />
      <MobileMenu />
      <CartDrawer />
      <WishlistDrawer />
      <SearchPanel />
      <QuickView />
      {f.requestOpen && <RequestGate />}
    </div>
  );
}

export default function Clothing() {
  // The fashion fonts are only loaded on this page.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet"; link.href = FONTS;
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, []);
  return <FashionProvider><Shell /></FashionProvider>;
}
