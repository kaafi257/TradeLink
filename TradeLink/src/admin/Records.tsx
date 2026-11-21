import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Boxes, ChevronDown, FileText, Package, Receipt, ShoppingCart, Truck, Users } from "lucide-react";

export type Tone = "good" | "warn" | "bad" | "muted" | "info";

/** "5m", "3h", "2d": short enough to scan. */
export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

/** Picks an icon for an activity line from what it is about. */
export const activityIcon = (text: string) => {
  const t = text.toLowerCase();
  if (/sale|receipt|payment/.test(t)) return <Receipt size={16} />;
  if (/quot/.test(t)) return <FileText size={16} />;
  if (/deliver|dispatch/.test(t)) return <Truck size={16} />;
  if (/stock|inventory/.test(t)) return <Boxes size={16} />;
  if (/staff|member|user/.test(t)) return <Users size={16} />;
  if (/order/.test(t)) return <ShoppingCart size={16} />;
  return <Package size={16} />;
};

/** Counts up from zero when it first appears. Skips the motion if the person prefers less of it. */
export function CountUp({ value }: { value: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setN(value); return; }
    let raf = 0; const t0 = performance.now(), dur = 700;
    const tick = (t: number) => { const k = Math.min(1, (t - t0) / dur); setN(Math.round(value * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n}</>;
}

/** Status as a coloured chip with an icon. `pulse` draws the eye to things waiting for action. */
export function StatusChip({ tone, icon, pulse, children }: { tone: Tone; icon?: ReactNode; pulse?: boolean; children: ReactNode }) {
  return <span className={`schip ${tone}${pulse ? " pulse" : ""}`}>{icon}{children}</span>;
}

/** Round icon button. Only the primary action also shows its word. */
export function IconBtn({ icon, label, tone = "neutral", primary, onClick, disabled, href, external }: {
  icon: ReactNode; label: string; tone?: "neutral" | "green" | "gold" | "red" | "wa" | "tg"; primary?: boolean; onClick?: () => void; disabled?: boolean; href?: string; external?: boolean;
}) {
  const cls = `ibtn ${tone}${primary ? " primary" : ""}`;
  const body = <>{icon}{primary && <span>{label}</span>}</>;
  return href
    ? <a className={cls} href={href} title={label} aria-label={label} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{body}</a>
    : <button type="button" className={cls} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{body}</button>;
}

export function RecordList({ isEmpty, empty, icon, children }: { isEmpty: boolean; empty: string; icon?: ReactNode; children: ReactNode }) {
  if (isEmpty) return <div className="rec-empty"><span>{icon ?? <Package />}</span><p>{empty}</p></div>;
  return <div className="rec-list">{children}</div>;
}

export type Fact = { icon: ReactNode; text: string; tone?: "price" | "cost" | "stock" | "place" | "time" };

/** One record as a glass card: icon or picture, title, a few icon facts, status and actions. Details open on tap. */
export function RecCard({ i = 0, tone = "info", lead, img, initials, title, sub, facts, control, amount, meter, status, actions, details }: {
  i?: number; tone?: Tone; lead?: ReactNode; img?: string | null; initials?: string; title: ReactNode; sub?: ReactNode; facts?: Fact[]; control?: ReactNode;
  amount?: ReactNode; meter?: number; status?: ReactNode; actions?: ReactNode; details?: [string, ReactNode][];
}) {
  const [open, setOpen] = useState(false);
  const shown = (facts ?? []).filter(f => f.text);
  return (
    <article className={`rec ${tone}${open ? " open" : ""}`} style={{ "--i": Math.min(i, 12) } as CSSProperties}>
      <div className="rec-main">
        <span className="rec-lead">{img ? <img src={img} alt="" /> : initials ? <b>{initials}</b> : lead}</span>
        <div className="rec-title"><b>{title}</b>{sub && <small>{sub}</small>}</div>
        {(shown.length > 0 || control) && (
          <div className="rec-facts">{shown.map(f => <span key={f.text} className={f.tone ? `ft-${f.tone}` : undefined} title={f.text}>{f.icon}<em>{f.text}</em></span>)}{control}</div>
        )}
        {amount !== undefined && (
          <div className="rec-amount"><b>{amount}</b>{meter !== undefined && <i className="meter"><s style={{ width: `${Math.max(4, Math.min(100, meter * 100))}%` }} /></i>}</div>
        )}
        {status && <div className="rec-status">{status}</div>}
        {actions && <div className="rec-actions">{actions}</div>}
        {details && details.length > 0 && <button type="button" className="rec-more" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpen(o => !o)}><ChevronDown size={18} /></button>}
      </div>
      {details && details.length > 0 && (
        <div className="rec-details"><dl>{details.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></div>
      )}
    </article>
  );
}

export const initialsOf = (name: string) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "?";
