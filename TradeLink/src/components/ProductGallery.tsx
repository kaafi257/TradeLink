import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, X } from "lucide-react";

const SWIPE = 44;

/** Horizontal swipe on touch and mouse. Vertical movement is left to the page. */
function useSwipe(onPrev: () => void, onNext: () => void, enabled = true) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: RPointerEvent) => { if (enabled) start.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: RPointerEvent) => {
      const s = start.current; start.current = null;
      if (!s || !enabled) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.4) (dx < 0 ? onNext : onPrev)();
    },
    onPointerCancel: () => { start.current = null; },
  };
}

function Thumbs({ urls, at, onPick, className }: { urls: string[]; at: number; onPick: (i: number) => void; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { (ref.current?.children[at] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); }, [at]);
  return (
    <div className={className} ref={ref} role="tablist" aria-label="Product photos">
      {urls.map((u, i) => (
        <button key={u} role="tab" aria-selected={i === at} aria-label={`Photo ${i + 1} of ${urls.length}`} className={i === at ? "on" : ""} onClick={() => onPick(i)}><img src={u} alt="" loading="lazy" /></button>
      ))}
    </div>
  );
}

/** Goes inside the existing product image box. With one photo it looks exactly as before; the photo can still be opened large. */
export function ProductGallery({ urls, name, fallback }: { urls: string[]; name: string; fallback: ReactNode }) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState(false);
  const n = urls.length;
  useEffect(() => { if (at >= n) setAt(0); }, [n, at]);
  const go = useCallback((d: number) => setAt(v => (n ? (v + d + n) % n : 0)), [n]);
  const swipe = useSwipe(() => go(-1), () => go(1), n > 1);
  if (n === 0) return <>{fallback}</>;
  return (
    <>
      <div className={`tl-gal${n > 1 ? " multi" : ""}`}>
        <div className="stage" {...swipe}>
          <button className="main" aria-label={`Open photo ${at + 1} large`} onClick={() => setOpen(true)}>
            <img key={urls[at]} src={urls[at]} alt={`${name}${n > 1 ? `, photo ${at + 1} of ${n}` : ""}`} draggable={false} />
            <span className="zoom" aria-hidden="true"><Maximize2 size={15} /></span>
          </button>
          {n > 1 && <>
            <button className="nav prev" aria-label="Previous photo" onClick={() => go(-1)}><ChevronLeft size={20} /></button>
            <button className="nav next" aria-label="Next photo" onClick={() => go(1)}><ChevronRight size={20} /></button>
            <span className="count" aria-live="polite">{at + 1}/{n}</span>
          </>}
        </div>
        {n > 1 && <Thumbs urls={urls} at={at} onPick={setAt} className="thumbs" />}
      </div>
      {open && createPortal(<ImageViewer urls={urls} start={at} name={name} onIndex={setAt} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/* ------------------------------------------------------------ full-screen viewer */

type Pt = { x: number; y: number };

function ImageViewer({ urls, start, name, onIndex, onClose }: { urls: string[]; start: number; name: string; onIndex: (i: number) => void; onClose: () => void }) {
  const [at, setAt] = useState(start);
  const [z, setZ] = useState(1);
  const [pos, setPos] = useState<Pt>({ x: 0, y: 0 });
  const n = urls.length;
  const box = useRef<HTMLDivElement>(null);
  const ptrs = useRef(new Map<number, Pt>());
  const pinch = useRef<{ d: number; z: number } | null>(null);
  const drag = useRef<{ p: Pt; o: Pt } | null>(null);
  const tap = useRef<{ t: number; p: Pt } | null>(null);

  const reset = () => { setZ(1); setPos({ x: 0, y: 0 }); };
  const go = useCallback((d: number) => { setAt(v => { const x = (v + d + n) % n; onIndex(x); return x; }); setZ(1); setPos({ x: 0, y: 0 }); }, [n, onIndex]);
  const clampZ = (v: number) => Math.min(5, Math.max(1, v));
  const setZoom = (v: number) => { const c = clampZ(v); setZ(c); if (c === 1) setPos({ x: 0, y: 0 }); };

  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowLeft" && n > 1) go(-1);
      else if (e.key === "ArrowRight" && n > 1) go(1);
      else if (e.key === "+" || e.key === "=") setZ(v => clampZ(v + 0.5));
      else if (e.key === "-") setZoom(z - 0.5);
    };
    document.addEventListener("keydown", k, true);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", k, true); };
  });

  const down = (e: RPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2) { const [a, b] = [...ptrs.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), z }; drag.current = null; }
    else drag.current = { p: { x: e.clientX, y: e.clientY }, o: pos };
  };
  const move = (e: RPointerEvent) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.current.size === 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()];
      setZoom(pinch.current.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d));
    } else if (drag.current && z > 1) {
      setPos({ x: drag.current.o.x + e.clientX - drag.current.p.x, y: drag.current.o.y + e.clientY - drag.current.p.y });
    }
  };
  const up = (e: RPointerEvent) => {
    const had = drag.current; ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (!had || ptrs.current.size > 0) return;
    drag.current = null;
    const dx = e.clientX - had.p.x, dy = e.clientY - had.p.y;
    if (z <= 1.02 && n > 1 && Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy) * 1.4) { go(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) {
      const now = Date.now(), t = tap.current;
      if (t && now - t.t < 320) { tap.current = null; if (z > 1) reset(); else setZ(2.5); }
      else tap.current = { t: now, p: { x: e.clientX, y: e.clientY } };
    }
  };
  const wheel = (e: React.WheelEvent) => { setZoom(z - e.deltaY * 0.002 * z); };

  return (
    <div className="tl-viewer" role="dialog" aria-modal="true" aria-label={`${name} photos`}>
      <header>
        <span className="count">{at + 1}/{n}</span>
        <div className="tools">
          <button aria-label="Zoom out" disabled={z <= 1} onClick={() => setZoom(z - 0.75)}><Minus size={18} /></button>
          <button aria-label="Zoom in" disabled={z >= 5} onClick={() => setZ(clampZ(z + 0.75))}><Plus size={18} /></button>
          <button aria-label="Close" className="close" onClick={onClose}><X size={22} /></button>
        </div>
      </header>
      <div className="vstage" ref={box} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} style={{ cursor: z > 1 ? "grab" : "zoom-in" }}>
        <img key={urls[at]} src={urls[at]} alt={`${name}, photo ${at + 1} of ${n}`} draggable={false}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${z})`, transition: drag.current || pinch.current ? "none" : "transform .2s ease" }} />
      </div>
      {n > 1 && <>
        <button className="vnav prev" aria-label="Previous photo" onClick={() => go(-1)}><ChevronLeft size={26} /></button>
        <button className="vnav next" aria-label="Next photo" onClick={() => go(1)}><ChevronRight size={26} /></button>
        <Thumbs urls={urls} at={at} onPick={i => { setAt(i); onIndex(i); reset(); }} className="vthumbs" />
      </>}
    </div>
  );
}
