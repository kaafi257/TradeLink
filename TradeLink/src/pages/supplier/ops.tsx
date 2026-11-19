import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2, X } from "lucide-react";
import { errorText } from "../../lib/supabase";

export const money = (n: unknown) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0)} ETB`;
export const qty = (n: unknown) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(n) || 0);
export const dateOf = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—");
export const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export type SProduct = {
  id: string; supplier_id: string; name: string; description: string | null; category_id: string | null; subcategory: string | null; brand: string | null;
  sku: string | null; unit: string; price: number; min_order_qty: number; bulk_tiers: { min_qty: number; price: number }[]; reorder_level: number;
  image_paths: string[]; status: "pending" | "approved" | "rejected"; review_note: string | null; active: boolean; created_at: string;
};
export type Warehouse = { id: string; supplier_id: string; name: string; address: string | null; active: boolean };
export type StockRow = { product_id: string; warehouse_id: string; available: number; incoming: number; reserved: number; damaged: number };
export type PO = { id: string; po_number: string; supplier_id: string; store_name: string; store_note: string | null; supplier_note: string | null; status: POStatus; total_amount: number; cancel_reason: string | null; created_at: string; accepted_at: string | null; dispatched_at: string | null; delivered_at: string | null };
export type POItem = { id: string; po_id: string; product_id: string; product_name: string; unit: string; qty_ordered: number; qty_confirmed: number | null; warehouse_id: string | null; unit_price: number };
export type POStatus = "new" | "accepted" | "rejected" | "preparing" | "ready_for_pickup" | "dispatched" | "delivered" | "cancelled";

export const PO_LABEL: Record<POStatus, string> = { new: "New", accepted: "Accepted", rejected: "Rejected", preparing: "Preparing", ready_for_pickup: "Ready for pickup", dispatched: "Dispatched", delivered: "Delivered", cancelled: "Cancelled" };
const TONE: Record<string, string> = { new: "wait", accepted: "good", preparing: "good", ready_for_pickup: "good", dispatched: "hold", delivered: "good", rejected: "bad", cancelled: "bad", pending: "wait", approved: "good" };
export const Pill = ({ s, label }: { s: string; label?: string }) => <span className={`sp-pill ${TONE[s] ?? "hold"}`}>{label ?? PO_LABEL[s as POStatus] ?? s[0].toUpperCase() + s.slice(1)}</span>;

/** Loads data once and again on demand. A newer request always wins over an older one. */
export function useLoad<T>(fn: () => PromiseLike<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const n = ++seq.current;
    try { const d = await fn(); if (n === seq.current) { setData(d); setError(""); } }
    catch (e) { if (n === seq.current) setError(errorText(e, "Could not load this page")); }
    finally { if (n === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run };
}

export const Spinner = () => <div className="sp-empty"><Loader2 className="spin" size={22} /></div>;

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k); document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="sp-modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`sp-dialog${wide ? " wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sp-dialog-head"><h3>{title}</h3><button className="sp-icon" aria-label="Close" onClick={onClose}><X size={18} /></button></div>
        <div className="sp-dialog-body">{children}</div>
      </div>
    </div>
  );
}
