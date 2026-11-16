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
export function GlassStat({ icon, tone, value, label, note, onOpen, spark, delta }: {
  icon: ReactNode; tone: string; value: string; label: string; note: string; onOpen?: () => void; spark?: number[]; delta?: number | null;
}) {
  const body = (
    <>
      <div className="gs-top"><span className="gs-icon">{icon}</span><span className="gs-label">{label}</span>{delta !== undefined && <Delta pct={delta} />}</div>
      <b className="gs-value">{value}</b>
      <div className="gs-foot"><span>{note}</span>{spark && <Sparkline values={spark} />}</div>
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
  const parts: { k: keyof StockSplit; label: string }[] = [{ k: "ok", label: "In stock" }, { k: "low", label: "Running low" }, { k: "out", label: "Out of stock" }];
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
        <div className="donut-mid"><b>{focus ? split[focus] : total}</b><small>{focus ? parts.find(p => p.k === focus)!.label : "products"}</small></div>
      </div>
      <ul className="donut-legend">
        {parts.map(({ k, label }) => (
          <li key={k}><button type="button" className={focus === k ? "on" : ""} onMouseEnter={() => setFocus(k)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(k)} onBlur={() => setFocus(null)} onClick={() => setFocus(f => (f === k ? null : k))}><i className={k} />{label}<b>{split[k]}</b></button></li>
        ))}
      </ul>
    </div>
  );
}
