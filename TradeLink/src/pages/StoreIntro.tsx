import { useEffect, useRef, useState } from "react";
import type { Text } from "./loginText";

/** Plays once after a successful sign-in: a shopper walks up to the TradeLink store, the glass doors open, the lights come on and the logo appears.
 *  Pure SVG + CSS keyframes (transform/opacity only), so it is cheap on phones. onDone fires after ~4.6s, or ~1.4s for reduced motion, or on skip. */
export const INTRO_MS = 4600;
export const INTRO_REDUCED_MS = 1400;

const stripes = Array.from({ length: 8 }, (_, i) => {
  const x1 = 240 + i * 40, x2 = x1 + 40, b1 = 220 + i * 45, b2 = b1 + 45;
  return { d: `M${x1} 122 L${x2} 122 L${b2} 172 A22.5 22.5 0 0 1 ${b1} 172 Z`, fill: i % 2 ? "#ffffff" : "#0b5d99" };
});
const boxes = [
  [262, 214, 28, 22, "#bcdcf5"], [294, 214, 28, 22, "#ffffff"], [326, 214, 20, 22, "#5aa5e0"], [462, 214, 28, 22, "#ffffff"], [494, 214, 28, 22, "#5aa5e0"],
  [262, 262, 24, 24, "#ffffff"], [290, 262, 30, 24, "#0b5d99"], [324, 262, 22, 24, "#bcdcf5"], [462, 262, 22, 24, "#bcdcf5"], [488, 262, 30, 24, "#ffffff"], [522, 262, 20, 24, "#0b5d99"],
  [262, 322, 40, 38, "#5aa5e0"], [306, 322, 36, 38, "#ffffff"], [468, 322, 36, 38, "#bcdcf5"], [508, 322, 34, 38, "#0b5d99"],
] as const;

export default function StoreIntro({ t, onDone }: { t: Text; onDone: () => void }) {
  const [narrow, setNarrow] = useState(false);
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    let reduced = false, small = false;
    try { reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches; small = window.matchMedia("(max-width:600px)").matches; } catch { /* old browser */ }
    setNarrow(small);
    const id = window.setTimeout(() => done.current(), reduced ? INTRO_REDUCED_MS : INTRO_MS);
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" || e.key === "Enter") done.current(); };
    window.addEventListener("keydown", key);
    return () => { window.clearTimeout(id); window.removeEventListener("keydown", key); };
  }, []);

  return (
    <div className="si" role="status" aria-live="polite" aria-label={t.welcomeTo}>
      <svg className="si-scene" viewBox={narrow ? "130 80 540 390" : "90 70 620 390"} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <radialGradient id="si-glow" cx="50%" cy="0%" r="90%"><stop offset="0" stopColor="#ffffff" /><stop offset=".55" stopColor="#dcecfb" /><stop offset="1" stopColor="#a9cdee" /></radialGradient>
          <linearGradient id="si-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#1b5ea8" /><stop offset="1" stopColor="#082a4e" /></linearGradient>
          <linearGradient id="si-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" stopOpacity=".55" /><stop offset="1" stopColor="#9fd0f5" stopOpacity=".18" /></linearGradient>
        </defs>

        <g className="si-city" fill="#0a3a73" opacity=".55"><rect x="-300" y="300" width="240" height="80" /><rect x="860" y="290" width="260" height="90" />
          {[[40, 220, 60, 160], [110, 170, 50, 210], [170, 240, 70, 140], [630, 200, 56, 180], [696, 150, 58, 230], [764, 230, 60, 150]].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="3" />)}
        </g>
        <rect x="-500" y="380" width="1800" height="140" fill="url(#si-ground)" />
        <path d="M330 380 H470 L560 460 H240Z" fill="#2b72bd" opacity=".55" />

        {/* store */}
        <rect x="230" y="168" width="340" height="212" rx="6" fill="#f2f7fc" />
        <rect x="250" y="200" width="300" height="180" fill="#dcecfb" />
        <g className="si-inside">
          <rect x="250" y="200" width="300" height="180" fill="url(#si-glow)" className="si-lit" />
          <g className="si-shelves">
            <rect x="256" y="240" width="96" height="5" rx="2" fill="#0b5d99" /><rect x="256" y="288" width="96" height="5" rx="2" fill="#0b5d99" /><rect x="256" y="360" width="96" height="6" rx="2" fill="#0b5d99" />
            <rect x="456" y="240" width="90" height="5" rx="2" fill="#0b5d99" /><rect x="456" y="288" width="90" height="5" rx="2" fill="#0b5d99" /><rect x="456" y="360" width="90" height="6" rx="2" fill="#0b5d99" />
            {boxes.map(([x, y, w, h, c], i) => <rect key={i} x={x} y={y + (y < 250 ? 4 : y < 300 ? 2 : 0)} width={w} height={h} rx="3" fill={c} stroke="#073256" strokeOpacity=".25" />)}
            <rect x="372" y="326" width="56" height="34" rx="4" fill="#0b5d99" /><rect x="372" y="322" width="56" height="6" rx="3" fill="#073256" />
          </g>
          {[300, 400, 500].map(x => <g key={x}><rect x={x - 1.5} y="200" width="3" height="10" fill="#073256" /><path d={`M${x - 14} 222 L${x - 8} 210 H${x + 8} L${x + 14} 222Z`} fill="#ffffff" /></g>)}
          <rect x="250" y="200" width="300" height="180" fill="#06223f" className="si-dark" />
        </g>
        {/* windows glass */}
        <rect x="250" y="200" width="100" height="180" fill="url(#si-glass)" /><rect x="450" y="200" width="100" height="180" fill="url(#si-glass)" />
        <path d="M262 372 L316 204 M290 372 L344 204" stroke="#fff" strokeOpacity=".35" strokeWidth="6" />
        <path d="M462 372 L516 204 M490 372 L544 204" stroke="#fff" strokeOpacity=".35" strokeWidth="6" />
        <rect x="248" y="198" width="104" height="184" fill="none" stroke="#fff" strokeWidth="4" /><rect x="448" y="198" width="104" height="184" fill="none" stroke="#fff" strokeWidth="4" />
        <rect x="352" y="196" width="96" height="186" fill="#ffffff" />
        <rect x="355" y="205" width="90" height="175" fill="#dcecfb" />
        <rect x="355" y="205" width="90" height="175" fill="url(#si-glow)" className="si-lit" />
        <rect x="355" y="205" width="90" height="175" fill="#06223f" className="si-dark" />
        <g className="si-door si-door-l"><rect x="355" y="205" width="45" height="175" fill="url(#si-glass)" stroke="#fff" strokeWidth="4" /><rect x="391" y="280" width="4" height="34" rx="2" fill="#073256" /><path d="M364 372 L388 212" stroke="#fff" strokeOpacity=".45" strokeWidth="5" /></g>
        <g className="si-door si-door-r"><rect x="400" y="205" width="45" height="175" fill="url(#si-glass)" stroke="#fff" strokeWidth="4" /><rect x="405" y="280" width="4" height="34" rx="2" fill="#073256" /><path d="M412 372 L436 212" stroke="#fff" strokeOpacity=".45" strokeWidth="5" /></g>
        <rect x="230" y="378" width="340" height="8" rx="3" fill="#0b5d99" />
        {/* sign + awning */}
        <rect x="324" y="76" width="152" height="50" rx="10" fill="#ffffff" stroke="#0b5d99" strokeWidth="3" />
        <image href="/brand/logo-mark.png" x="383" y="80" width="42" height="42" preserveAspectRatio="xMidYMid meet" />
        <rect x="230" y="116" width="340" height="8" rx="3" fill="#073256" />
        {stripes.map((s, i) => <path key={i} d={s.d} fill={s.fill} stroke="#073256" strokeOpacity=".25" strokeWidth="1" />)}

        {/* shopper */}
        <g className="si-walker">
          <g className="si-fade" transform="translate(0 380) scale(.8)">
            <ellipse cx="0" cy="0" rx="30" ry="6" fill="#000" opacity=".28" />
            <g transform="translate(0 -71)">
              <g className="si-bob">
                <g transform="translate(0 -44)"><g className="si-arm si-arm-b"><rect x="-8" y="0" width="16" height="50" rx="8" fill="#08467a" /><circle cx="0" cy="52" r="8" fill="#c98f63" /></g></g>
                <g transform="translate(0 0)"><g className="si-leg si-leg-b"><rect x="-10" y="0" width="20" height="62" rx="9" fill="#06223f" /><ellipse cx="6" cy="64" rx="15" ry="7" fill="#fff" /></g></g>
                <rect x="-40" y="-52" width="20" height="44" rx="9" fill="#073256" />
                <rect x="-26" y="-58" width="52" height="62" rx="20" fill="#0b5d99" />
                <g transform="translate(0 0)"><g className="si-leg si-leg-a"><rect x="-10" y="0" width="20" height="62" rx="9" fill="#0a2f57" /><ellipse cx="6" cy="64" rx="15" ry="7" fill="#fff" /></g></g>
                <circle cx="0" cy="-82" r="22" fill="#d9a074" />
                <path d="M-22 -86 C-22 -108 20 -110 22 -86 C10 -96 -8 -98 -22 -86Z" fill="#2a1a12" />
                <circle cx="9" cy="-84" r="2.4" fill="#1b1209" /><circle cx="-5" cy="-84" r="2.4" fill="#1b1209" />
                <path d="M2 -72 Q9 -66 16 -73" stroke="#7a3b22" strokeWidth="2.4" fill="none" strokeLinecap="round" />
                <g transform="translate(0 -44)"><g className="si-arm si-arm-a"><rect x="-8" y="0" width="16" height="50" rx="8" fill="#0b5d99" /><circle cx="0" cy="52" r="8" fill="#d9a074" /></g></g>
              </g>
            </g>
          </g>
        </g>
      </svg>

      <div className="si-reveal">
        <div className="si-card">
          <img src="/brand/logo-full.png" alt="TradeLink — Wholesale and retail in one place" width="360" height="90" />
          <h2>{t.welcomeTo}</h2>
          <p>{t.opening}</p>
          <i className="si-bar" aria-hidden="true" />
        </div>
      </div>
      <button type="button" className="si-skip" onClick={() => onDone()}>{t.skip}</button>
    </div>
  );
}
