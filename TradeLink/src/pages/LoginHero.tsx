/** Decorative storefront + phone + cart illustration for the login panel (blue and white only). */
export default function LoginHero() {
  const aw = Array.from({ length: 6 }, (_, i) => ({ x: 70 + i * 28, f: i % 2 ? "#ffffff" : "#1d6fc2" }));
  return (
    <svg className="lg-hero" viewBox="0 0 560 300" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="lh-phone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#1e6fd0" /><stop offset="1" stopColor="#0a3a86" /></linearGradient>
        <radialGradient id="lh-floor" cx="50%" cy="50%" r="50%"><stop offset="0" stopColor="#2a7ae0" /><stop offset="1" stopColor="#0a3f86" stopOpacity="0" /></radialGradient>
      </defs>
      <g fill="#1a58a8" opacity=".55">{[[0, 150, 34, 120], [38, 110, 30, 160], [72, 160, 28, 110], [420, 140, 34, 130], [458, 100, 30, 170], [492, 150, 34, 120], [530, 120, 30, 150]].map(([x, y, w, h], i) => <rect key={i} x={x} y={y} width={w} height={h} rx="2" />)}</g>
      <ellipse cx="280" cy="268" rx="270" ry="30" fill="url(#lh-floor)" />
      {/* store */}
      <rect x="62" y="132" width="196" height="130" rx="4" fill="#f4f8fd" />
      <rect x="78" y="168" width="52" height="64" rx="3" fill="#8fc0f2" /><rect x="78" y="168" width="52" height="64" rx="3" fill="none" stroke="#1d6fc2" strokeWidth="3" />
      <rect x="150" y="164" width="48" height="98" rx="3" fill="#bcdcf5" stroke="#1d6fc2" strokeWidth="3" /><circle cx="190" cy="214" r="3" fill="#0a3a86" />
      <rect x="212" y="168" width="34" height="64" rx="3" fill="#8fc0f2" stroke="#1d6fc2" strokeWidth="3" />
      {aw.map((a, i) => <path key={i} d={`M${a.x + 4} 108 H${a.x + 32} L${a.x + 36} 148 A14 14 0 0 1 ${a.x + 8} 148 Z`} fill={a.f} stroke="#0a3a86" strokeOpacity=".3" />)}
      <rect x="66" y="102" width="176" height="8" rx="3" fill="#0a3a86" />
      <rect x="54" y="258" width="212" height="8" rx="3" fill="#0a3a86" opacity=".6" />
      {/* phone */}
      <g transform="rotate(5 360 160)">
        <rect x="262" y="40" width="156" height="230" rx="22" fill="#0a2a5e" stroke="#e6f0fb" strokeWidth="4" />
        <rect x="270" y="50" width="140" height="210" rx="16" fill="url(#lh-phone)" />
        <rect x="318" y="54" width="44" height="8" rx="4" fill="#0a2a5e" />
        <g transform="translate(300 100)" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M0 0 H14 L26 52 H68 L78 18 H18" /><circle cx="32" cy="68" r="4" fill="#fff" /><circle cx="62" cy="68" r="4" fill="#fff" /><path d="M30 30 H72 M34 42 H70" strokeWidth="4" />
        </g>
      </g>
      {/* cart + boxes */}
      <g fill="none" stroke="#e6f0fb" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M222 190 H232 L244 246 H328 L342 202 H236" /><path d="M240 222 H338 M236 206 H340" strokeWidth="3" /><path d="M262 202 L266 246 M286 202 L288 246 M310 202 L310 246" strokeWidth="3" />
      </g>
      <circle cx="256" cy="260" r="6" fill="#e6f0fb" /><circle cx="324" cy="260" r="6" fill="#e6f0fb" />
      <rect x="262" y="164" width="52" height="40" rx="4" fill="#bcdcf5" /><path d="M262 178 H314" stroke="#5aa5e0" strokeWidth="5" /><rect x="286" y="164" width="6" height="14" fill="#5aa5e0" />
      <g><rect x="16" y="214" width="58" height="46" rx="4" fill="#bcdcf5" /><path d="M16 228 H74" stroke="#5aa5e0" strokeWidth="5" /><rect x="40" y="214" width="8" height="14" fill="#5aa5e0" />
        <rect x="72" y="226" width="44" height="34" rx="4" fill="#e6f0fb" /><path d="M72 238 H116" stroke="#5aa5e0" strokeWidth="4" />
        <rect x="30" y="178" width="46" height="38" rx="4" fill="#e6f0fb" /><path d="M30 190 H76" stroke="#5aa5e0" strokeWidth="4" /></g>
    </svg>
  );
}
