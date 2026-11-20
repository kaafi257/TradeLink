import { useEffect, useRef, useState } from "react";
import { ArrowRight, Pause, Play } from "lucide-react";
import type { CampaignAction, CampaignScene, CampaignSlide } from "../../lib/supabase";
import "./campaign.css";

type Mode = "business" | "individual";
type Props = { slides: CampaignSlide[]; products: number; suppliers: number; industries: number; onShop: (m: Mode) => void; onRegister: () => void; onQuote: () => void; preview?: boolean };

/** Used until the database answers, and if the campaign table is not installed yet. */
export const DEFAULT_SLIDES: CampaignSlide[] = [
  { id: "d1", scene: "wholesale", tag: "Wholesale", title: "Buy in bulk, straight from suppliers", body: "Minimum orders shown up front. Compare suppliers and order in one place.", cta_label: "Shop wholesale", cta_action: "shop_wholesale", sort_order: 10 },
  { id: "d2", scene: "retail", tag: "Retail", title: "Just need a few? Shop retail too", body: "Switch between wholesale and retail in one tap. Same marketplace, same trusted suppliers.", cta_label: "Shop retail", cta_action: "shop_retail", sort_order: 20 },
  { id: "d3", scene: "supplier", tag: "For suppliers", title: "Open your store on TradeLink", body: "Register your business, list your products and reach buyers across the marketplace.", cta_label: "Register your business", cta_action: "register", sort_order: 30 },
  { id: "d4", scene: "quote", tag: "Bulk orders", title: "Need a price for a big order?", body: "Send your requirements and get a quote from the team.", cta_label: "Request a quote", cta_action: "quote", sort_order: 40 },
];
export const SCENE_LABEL: Record<CampaignScene, string> = { wholesale: "Delivery truck", retail: "Wholesale / retail switch", supplier: "Store opening", quote: "Quote chat" };
export const ACTION_LABEL: Record<CampaignAction, string> = { shop_wholesale: "Shop wholesale", shop_retail: "Shop retail", register: "Supplier registration", quote: "Quote request" };
const SCENE_MS = 5200;

/** Animated advertising campaign for the homepage: four short scenes (wholesale, retail, sell with us, bulk quotes) that loop.
 *  Numbers come from the live catalogue (hidden when zero); nothing is invented. Pure SVG + CSS (transform/opacity), pauses on hover/focus, and shows a still frame with manual dots for reduced motion. */
export default function Campaign({ slides, products, suppliers, industries, onShop, onRegister, onQuote, preview = false }: Props) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const hold = useRef(false);
  const slidesLen = useRef(slides.length); slidesLen.current = slides.length;
  useEffect(() => { try { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch { /* old browser */ } }, []);
  useEffect(() => {
    if (paused || reduced) return;
    const id = window.setInterval(() => { if (!hold.current && !document.hidden) setI(n => (n + 1) % Math.max(1, slidesLen.current)); }, SCENE_MS);
    return () => window.clearInterval(id);
  }, [paused, reduced]);

  const stats = [products > 0 && `${products} products`, suppliers > 0 && `${suppliers} suppliers`, industries > 0 && `${industries} industries`].filter(Boolean) as string[];
  const run = (a: CampaignAction) => { if (preview) return; if (a === "shop_wholesale") onShop("business"); else if (a === "shop_retail") onShop("individual"); else if (a === "register") onRegister(); else onQuote(); };
  const scenes = slides.map(x => ({ k: x.scene as CampaignScene, id: x.id, tag: x.tag, title: x.title, text: x.body, cta: x.cta_label, go: () => run(x.cta_action) }));
  useEffect(() => { if (i >= scenes.length) setI(0); }, [i, scenes.length]);
  if (scenes.length === 0) return null;
  const s = scenes[Math.min(i, scenes.length - 1)];
  return (
    <section className="tl-sec" aria-roledescription="carousel" aria-label="TradeLink campaign">
      <div className="tl-wrap">
        <div className={`cmp cmp-${s.k}`} onMouseEnter={() => (hold.current = true)} onMouseLeave={() => (hold.current = false)} onFocusCapture={() => (hold.current = true)} onBlurCapture={() => (hold.current = false)}>
          <div className="cmp-copy" key={s.id} aria-live={paused || reduced ? "polite" : "off"}>
            <span className="cmp-tag">{s.tag}</span>
            <h2>{s.title}</h2>
            <p>{s.text}</p>
            <div className="cmp-row">
              <button type="button" className="cmp-cta" onClick={s.go}>{s.cta}<ArrowRight size={17} /></button>
              {stats.length > 0 && <small>{stats.join(" · ")}</small>}
            </div>
          </div>
          <div className="cmp-art" key={`a${s.id}`} aria-hidden="true">
            <svg viewBox="0 0 420 220" preserveAspectRatio="xMidYMid meet">
              <rect x="0" y="176" width="420" height="44" fill="#0a3a86" opacity=".55" />
              <g className="cmp-dash"><path d="M-40 198 H460" stroke="#cfe3f8" strokeWidth="3" strokeDasharray="22 18" opacity=".6" /></g>
              {s.k === "wholesale" && <g>
                <g className="cmp-truck"><rect x="0" y="108" width="104" height="62" rx="6" fill="#fff" /><rect x="104" y="128" width="42" height="42" rx="6" fill="#4aa3ff" /><rect x="116" y="136" width="20" height="14" rx="3" fill="#dcebfb" />
                  <g className="cmp-box b1"><rect x="10" y="84" width="34" height="26" rx="3" fill="#bcdcf5" /><rect x="10" y="94" width="34" height="5" fill="#5aa5e0" /></g>
                  <g className="cmp-box b2"><rect x="50" y="84" width="34" height="26" rx="3" fill="#fff" /><rect x="50" y="94" width="34" height="5" fill="#5aa5e0" /></g>
                  <rect x="6" y="140" width="92" height="8" rx="3" fill="#0b5d99" /><circle className="cmp-wheel" cx="32" cy="172" r="14" fill="#073256" /><circle className="cmp-wheel" cx="122" cy="172" r="14" fill="#073256" /><circle cx="32" cy="172" r="5" fill="#dcebfb" /><circle cx="122" cy="172" r="5" fill="#dcebfb" /></g>
                <g className="cmp-pop p1"><rect x="40" y="30" width="86" height="30" rx="15" fill="#fff" /><text x="83" y="50" textAnchor="middle" fontSize="13" fontWeight="700" fill="#073256">Bulk price</text></g>
              </g>}
              {s.k === "retail" && <g>
                <g className="cmp-switch"><rect x="110" y="70" width="200" height="56" rx="28" fill="#0a3a86" stroke="#4aa3ff" strokeWidth="3" /><text x="152" y="105" textAnchor="middle" fontSize="15" fontWeight="700" fill="#dcebfb">Wholesale</text><text x="268" y="105" textAnchor="middle" fontSize="15" fontWeight="700" fill="#fff">Retail</text>
                  <rect className="cmp-knob" x="116" y="76" width="104" height="44" rx="22" fill="#4aa3ff" opacity=".85" /></g>
                <g className="cmp-bag"><path d="M170 140 h80 l8 36 h-96z" fill="#fff" /><path d="M190 140 v-10 a20 20 0 0 1 40 0 v10" fill="none" stroke="#fff" strokeWidth="6" /><path d="M192 156 h36" stroke="#4aa3ff" strokeWidth="5" strokeLinecap="round" /></g>
              </g>}
              {s.k === "supplier" && <g>
                <rect x="120" y="86" width="180" height="90" rx="4" fill="#f2f7fc" /><rect x="186" y="116" width="48" height="60" rx="3" fill="#bcdcf5" />
                <g className="cmp-door"><rect x="186" y="116" width="24" height="60" fill="#8fc0f2" stroke="#fff" strokeWidth="3" /></g>
                <g className="cmp-awning">{Array.from({ length: 6 }, (_, k) => <rect key={k} x={110 + k * 33.4} y="62" width="33.4" height="30" fill={k % 2 ? "#fff" : "#1d6fc2"} />)}<rect x="110" y="58" width="200" height="6" rx="3" fill="#073256" /></g>
                <g className="cmp-pop p2"><rect x="238" y="22" width="120" height="30" rx="15" fill="#fff" /><text x="298" y="42" textAnchor="middle" fontSize="13" fontWeight="700" fill="#073256">Now open</text></g>
              </g>}
              {s.k === "quote" && <g>
                <g className="cmp-msg m1"><rect x="60" y="40" width="170" height="44" rx="14" fill="#fff" /><rect x="76" y="56" width="110" height="7" rx="3.5" fill="#bcdcf5" /><rect x="76" y="68" width="70" height="7" rx="3.5" fill="#bcdcf5" /></g>
                <g className="cmp-msg m2"><rect x="190" y="98" width="170" height="44" rx="14" fill="#4aa3ff" /><rect x="206" y="114" width="110" height="7" rx="3.5" fill="#fff" opacity=".9" /><rect x="206" y="126" width="70" height="7" rx="3.5" fill="#fff" opacity=".9" /></g>
                <g className="cmp-msg m3"><rect x="60" y="150" width="110" height="34" rx="14" fill="#fff" /><circle className="cmp-dot d1" cx="92" cy="167" r="5" fill="#0b5d99" /><circle className="cmp-dot d2" cx="115" cy="167" r="5" fill="#0b5d99" /><circle className="cmp-dot d3" cx="138" cy="167" r="5" fill="#0b5d99" /></g>
              </g>}
            </svg>
          </div>
          <div className="cmp-ctl">
            <div className="cmp-dots" role="tablist" aria-label="Campaign scenes">
              {scenes.map((x, n) => (
                <button key={x.id} type="button" role="tab" aria-selected={n === i} aria-label={`${x.tag}`} className={n === i ? "on" : ""} onClick={() => setI(n)}>
                  <i style={n === i && !paused && !reduced ? { animationDuration: `${SCENE_MS}ms` } : undefined} />
                </button>
              ))}
            </div>
            {!reduced && <button type="button" className="cmp-pause" onClick={() => setPaused(p => !p)} aria-label={paused ? "Play campaign" : "Pause campaign"}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
