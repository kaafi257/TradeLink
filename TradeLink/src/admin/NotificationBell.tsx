import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ClipboardList, ShieldCheck, Smartphone } from "lucide-react";
import { requireSupabase } from "../lib/supabase";
import { useAdmin } from "./AdminData";

type Counts = { verify: number; waiting: number };

/** Bell in the top bar: new quote requests, bank/wallet payments waiting for the customer, and transfers waiting for you to verify. */
export default function NotificationBell({ role }: { role: string }) {
  const { newQuoteCount, can } = useAdmin();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<Counts>({ verify: 0, waiting: 0 });
  const box = useRef<HTMLDivElement>(null);
  const canPay = can("payments.view") || role === "owner";
  const load = useCallback(async () => {
    if (!canPay) return;
    try {
      const db = requireSupabase();
      const [v, w] = await Promise.all([
        db.from("payments").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        db.from("payments").select("id", { count: "exact", head: true }).eq("status", "pending").neq("method", "cod"),
      ]);
      setC({ verify: v.count ?? 0, waiting: w.count ?? 0 });
    } catch { /* the bell keeps its last numbers */ }
  }, [canPay]);
  useEffect(() => { void load(); const t = window.setInterval(() => void load(), 30000); const f = () => void load(); window.addEventListener("focus", f); return () => { window.clearInterval(t); window.removeEventListener("focus", f); }; }, [load]);
  useEffect(() => {
    if (!open) return;
    const d = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", d); return () => document.removeEventListener("mousedown", d);
  }, [open]);
  const quotes = ["owner", "manager", "sales"].includes(role) ? newQuoteCount : 0;
  const total = quotes + c.verify + c.waiting;
  const go = (to: string) => { setOpen(false); nav(to); };
  const items = [
    c.verify > 0 && { Icon: ShieldCheck, text: `${c.verify} ${c.verify === 1 ? "transfer" : "transfers"} to verify`, hint: "Customer sent proof", to: "/admin/payments", hot: true },
    c.waiting > 0 && { Icon: Smartphone, text: `${c.waiting} ${c.waiting === 1 ? "order" : "orders"} waiting for payment`, hint: "Bank, Telebirr or eBirr", to: "/admin/payments" },
    quotes > 0 && { Icon: ClipboardList, text: `${quotes} new quote ${quotes === 1 ? "request" : "requests"}`, hint: "Price requests", to: "/admin/quotations" },
  ].filter(Boolean) as { Icon: typeof Bell; text: string; hint: string; to: string; hot?: boolean }[];
  return (
    <div className="nb" ref={box}>
      <button className="notification-button" title="Notifications" aria-label={`${total} notifications`} aria-expanded={open} onClick={() => { setOpen(o => !o); void load(); }}>
        <Bell />{total > 0 && <i>{total > 99 ? "99+" : total}</i>}
      </button>
      {open && (
        <div className="nb-pop" role="menu">
          <b>Notifications</b>
          {items.length === 0 ? <p>Nothing new right now.</p> : items.map(i => (
            <button key={i.text} role="menuitem" className={i.hot ? "hot" : ""} onClick={() => go(i.to)}><span><i.Icon size={17} /></span><em><strong>{i.text}</strong><small>{i.hint}</small></em></button>))}
        </div>)}
    </div>
  );
}
