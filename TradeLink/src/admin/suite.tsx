import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Star, X } from "lucide-react";
import { errorText, requireSupabase } from "../lib/supabase";
import { useAdmin } from "./AdminData";

/** Loads data when the page opens and whenever `reload` is called. Failures show as a message, never a blank page. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    setLoading(true);
    fn().then(d => { if (n === seq.current) { setData(d); setError(""); } })
      .catch(e => { if (n === seq.current) setError(errorText(e, "Could not load this page. If the database update (0017) has not been run yet, run it in Supabase first.")); })
      .finally(() => { if (n === seq.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { data, error, loading, reload: run };
}

/** Calls a database function and returns its result; the database decides whether the person is allowed. */
export async function callRpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(name, args ?? {});
  if (error) throw error;
  return data as T;
}

/** Runs an action with a busy flag and a toast for the result. */
export function useAction() {
  const { notify } = useAdmin();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) notify(done); return true; }
    catch (e) { notify(errorText(e, "That did not work. Please try again.")); return false; }
    finally { setBusy(false); }
  }, [notify]);
  return { busy, run };
}

export function ErrorNote({ text }: { text: string }) {
  return text ? <div className="info-banner" role="alert" style={{ borderColor: "#f1b8b2" }}>{text}</div> : null;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; icon: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="su-tabs" role="tablist" aria-label={label}>
      {tabs.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>{t.icon}{t.label}{t.count ? ` (${t.count})` : ""}</button>
      ))}
    </div>
  );
}

export function Modal({ title, kicker, onClose, children }: { title: string; kicker?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-x" aria-label="Close" onClick={onClose}><X /></button>
        {kicker && <small className="kicker">{kicker}</small>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Form({ onSubmit, busy, submit, children }: { onSubmit: () => void; busy?: boolean; submit: string; children: ReactNode }) {
  return (
    <form className="su-form" onSubmit={(e: FormEvent) => { e.preventDefault(); onSubmit(); }}>
      {children}
      <div className="su-row end"><button className="btn green" disabled={busy}>{busy ? "Saving…" : submit}</button></div>
    </form>
  );
}

export function Stars({ value }: { value: number }) {
  return <span className="su-stars" role="img" aria-label={`${value} out of 5`}>{[1, 2, 3, 4, 5].map(n => <Star key={n} className={n <= value ? "" : "off"} fill={n <= value ? "currentColor" : "none"} />)}</span>;
}

export const dateOf = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "—");
export const dayRange = (days: number) => { const to = new Date(Date.now() + 864e5); const from = new Date(Date.now() - days * 864e5); return { p_from: from.toISOString(), p_to: to.toISOString() }; };
export const label = (s: string) => s.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
