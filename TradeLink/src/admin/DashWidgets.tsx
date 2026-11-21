import { useId, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/** Tiny trend line drawn from real values. Draws itself once when it appears. */
export function Sparkline({ values }: { values: number[] }) {
  const id = useId().replace(/:/g, "");
  if (values.length < 2 || values.every(v => v === 0)) return null;
  const w = 120, h = 36, max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - (v / max) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".28" /><stop offset="1" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path className="spark-line" d={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" pathLength={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Delta({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return <span className={`delta ${up ? "up" : "down"}`}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(Math.round(pct))}%</span>;
}

/** Glass KPI card. Becomes a button when it has somewhere to go. */
export function GlassStat({ icon, tone, value, label, chips, onOpen, spark, delta }: {
  icon: ReactNode; tone: string; value: string; label: string; chips?: ReactNode; onOpen?: () => void; spark?: number[]; delta?: number | null;
}) {
  const body = (
    <>
      <div className="gs-top"><span className="gs-icon">{icon}</span><span className="gs-label">{label}</span>{delta !== undefined && <Delta pct={delta} />}</div>
      <b className="gs-value">{value}</b>
      <div className="gs-foot"><span className="chips">{chips}</span>{spark && <Sparkline values={spark} />}</div>
    </>
  );
  return onOpen
    ? <button type="button" className={`glass gs ${tone} link`} onClick={onOpen} aria-label={`${label}: ${value}. Open`}>{body}</button>
    : <div className={`glass gs ${tone}`}>{body}</div>;
}

export type StockSplit = { ok: number; low: number; out: number };

/** Donut of stock health. Hover or tap a legend row to focus one slice. */
export function StockDonut({ split }: { split: StockSplit }) {
  const [focus, setFocus] = useState<keyof StockSplit | null>(null);
  const total = split.ok + split.low + split.out;
  const r = 38, c = 2 * Math.PI * r;
  const parts: { k: keyof StockSplit; label: string }[] = [{ k: "ok", label: "OK" }, { k: "low", label: "Low" }, { k: "out", label: "Out" }];
  let offset = 0;
  return (
    <div className="donut-wrap">
      <div className="donut" role="img" aria-label={`${split.ok} in stock, ${split.low} running low, ${split.out} out of stock`}>
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={r} className="donut-track" />
          {total > 0 && parts.map(({ k }) => {
            const len = (split[k] / total) * c;
            const el = <circle key={k} cx="50" cy="50" r={r} className={`donut-seg ${k}${focus && focus !== k ? " dim" : ""}`} strokeDasharray={`${Math.max(len - 2, 0)} ${c}`} strokeDashoffset={-offset} onMouseEnter={() => setFocus(k)} onMouseLeave={() => setFocus(null)} />;
            offset += len;
            return el;
          })}
        </svg>
        <div className="donut-mid"><b>{focus ? split[focus] : total}</b><small>{focus ? parts.find(p => p.k === focus)!.label : "items"}</small></div>
      </div>
      <ul className="donut-legend">
        {parts.map(({ k, label }) => (
          <li key={k}><button type="button" className={focus === k ? "on" : ""} onMouseEnter={() => setFocus(k)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(k)} onBlur={() => setFocus(null)} onClick={() => setFocus(f => (f === k ? null : k))}><i className={k} />{label}<b>{split[k]}</b></button></li>
        ))}
      </ul>
    </div>
  );
}

/** A small count with a coloured dot, used instead of explanatory sentences. */
export function Chip({ tone, children }: { tone: "good" | "warn" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`chip-dot ${tone}`}><i />{children}</span>;
}

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k` : String(Math.round(n)));

/** Chart for the dashboard banner: smooth area, gridlines, day labels and a hover read-out. Real values only. */
export function HeroChart({ data, unit = "ETB" }: { data: { day: string; sales: number }[]; unit?: string }) {
  const id = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const W = 420, H = 170, L = 38, R = 8, T = 10, B = 22;
  const n = data.length;
  if (n < 2) return null;
  const rawMax = Math.max(...data.map(d => d.sales), 1);
  const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const max = Math.ceil(rawMax / step) * step;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const pts = data.map((d, i) => [x(i), y(d.sales)] as const);
  // Smooth curve through the points without overshooting below zero.
  const line = pts.map(([px, py], i) => {
    if (!i) return `M${px.toFixed(1)} ${py.toFixed(1)}`;
    const [qx, qy] = pts[i - 1], mx = (px + qx) / 2;
    return `C${mx.toFixed(1)} ${qy.toFixed(1)} ${mx.toFixed(1)} ${py.toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}`;
  }).join(" ");
  const base = H - B;
  const area = `${line} L${x(n - 1).toFixed(1)} ${base} L${L} ${base} Z`;
  const grid = [0, 1, 2, 3].map(k => (max / 3) * k);
  const every = n > 20 ? 5 : n > 10 ? 3 : 1;
  const bestI = data.reduce((b, d, i) => (d.sales > data[b].sales ? i : b), 0);
  const at = (e: { clientX: number; currentTarget: SVGSVGElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  };
  const h = hover ?? bestI, hp = pts[h];
  const tipLeft = Math.min(Math.max((hp[0] / W) * 100, 16), 84);
  return (
    <div className="hc">
      <div className="hc-tip" style={{ left: `${tipLeft}%` }}><small>Day {data[h].day}</small><b>{Math.round(data[h].sales).toLocaleString("en-US")} {unit}</b></div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sales this month, day by day" onPointerMove={at} onPointerDown={at} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7fd0ff" stopOpacity=".55" /><stop offset="1" stopColor="#7fd0ff" stopOpacity="0" /></linearGradient>
        </defs>
        {grid.map((g, k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="hc-grid" />
            <text x={L - 6} y={y(g) + 3.5} textAnchor="end" className="hc-t">{short(g)}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${id})`} />
        <path d={line} className="hc-line" fill="none" pathLength={1} />
        {data.map((d, i) => (i % every === 0 || i === n - 1) && <text key={i} x={x(i)} y={H - 6} textAnchor="middle" className="hc-t">{d.day}</text>)}
        <line x1={hp[0]} x2={hp[0]} y1={T} y2={base} className="hc-cross" />
        <circle cx={hp[0]} cy={hp[1]} r="4.5" className="hc-dot" />
      </svg>
    </div>
  );
}
