import { useEffect, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import { oilImg, riceImg, sugarImg } from "../lib/assets";
import type { PublicProduct } from "../lib/supabase";
import { ContactIcons } from "./ContactActions";

type Slide = { key: string; name: string; sub: string; image: string; product: string; productId: string };

const STOCK: Slide[] = [
  { key: "c-rice", name: "Rice", sub: "Bulk supply · 25kg / 50kg+ bags", image: riceImg, product: "", productId: "" },
  { key: "c-sugar", name: "Sugar", sub: "Bulk supply · 25kg / 50kg+ bags", image: sugarImg, product: "", productId: "" },
  { key: "c-oil", name: "Cooking Oil", sub: "Bulk supply · 5L / 20L+ containers", image: oilImg, product: "", productId: "" },
];

/** Crossfading product photos with a slow zoom. Uses real products that have an image; stock photos otherwise. */
export function ProductShowcase({ products, onQuote }: { products: PublicProduct[]; onQuote: (productId: string) => void }) {
  const real: Slide[] = products.filter(p => p.image_url).slice(0, 6)
    .map(p => ({ key: p.id, name: p.name, sub: `${p.package_size || p.unit} · Large orders`, image: p.image_url!, product: p.package_size ? `${p.name} (${p.package_size})` : p.name, productId: p.id }));
  const slides = real.length ? real : STOCK;

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = useRef(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const count = slides.length;

  useEffect(() => { setIndex(0); }, [count]);
  useEffect(() => {
    if (reduced.current || paused || count < 2) return;
    const t = window.setInterval(() => setIndex(i => (i + 1) % count), 4800);
    return () => window.clearInterval(t);
  }, [paused, count]);

  const s = slides[index % count];
  const message = s.product
    ? `Hello TradeLink, I would like a wholesale price for ${s.product}.`
    : `Hello TradeLink, I would like a wholesale price for ${s.name}.`;

  return (
    <div className="showcase" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      {slides.map((sl, i) => (
        <div key={sl.key} className={`slide ${i === index % count ? "on" : ""}`} aria-hidden={i !== index % count}>
          <img src={sl.image} alt={i === index % count ? sl.name : ""} loading={i === 0 ? "eager" : "lazy"} />
        </div>
      ))}
      <div className="showcase-caption">
        <div>
          <b>{s.name}</b>
          <small>{s.sub}</small>
        </div>
        <div className="showcase-actions">
          <ContactIcons message={message} />
          <button className="btn gold" onClick={() => onQuote(s.productId)}><ClipboardList size={15} /> Quote</button>
        </div>
      </div>
      {count > 1 && (
        <div className="showcase-dots" role="tablist" aria-label="Product photos">
          {slides.map((sl, i) => (
            <button key={sl.key} role="tab" aria-selected={i === index % count} aria-label={`Show ${sl.name}`}
                    className={i === index % count ? "on" : ""} onClick={() => setIndex(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
