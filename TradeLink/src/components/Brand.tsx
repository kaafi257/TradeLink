import { useId } from "react";

/** The TradeLink mark: two interlocked links (white and gold) on a teal tile. Also used as public/favicon.svg. */
export function LogoMark({ size = 44 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="TradeLink logo">
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0b5a4d" /><stop offset="1" stopColor="#062a21" /></linearGradient>
        <clipPath id={`c${id}`}><rect x="0" y="24" width="48" height="24" /></clipPath>
      </defs>
      <rect width="48" height="48" rx="12" fill={`url(#g${id})`} />
      <g transform="rotate(-38 24 24)" fill="none" strokeWidth="4.4" strokeLinejoin="round">
        <rect x="5.5" y="16.5" width="22" height="15" rx="7.5" stroke="#ffffff" />
        <rect x="20.5" y="16.5" width="22" height="15" rx="7.5" stroke="#f4bc42" />
        <rect x="5.5" y="16.5" width="22" height="15" rx="7.5" stroke="#ffffff" clipPath={`url(#c${id})`} />
      </g>
    </svg>
  );
}

export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <LogoMark />
      <div><b>Trade<span>Link</span></b><small>B2B · B2C MARKETPLACE</small></div>
    </div>
  );
}
