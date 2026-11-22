import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Ban, CheckCircle2, Clock, Hourglass, Lock, RotateCcw, ShieldAlert, Undo2, XCircle } from "lucide-react";
import { Brand } from "../../components/Brand";
import { STATUS_HINT, STATUS_LABEL, STATUS_TONE, type OrderPayment, type PayStatus } from "../../lib/checkout";
import "./checkout.css";

export const etb = (n: number) => `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n) || 0)} ETB`;
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export function CoShell({ children, back }: { children: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="co-page">
      <header className="co-top">
        <Link to="/" aria-label="TradeLink home"><Brand /></Link>
        <span className="co-secure"><Lock size={15} /> Secure checkout</span>
        {back && <Link className="co-back" to={back.to}>{back.label}</Link>}
      </header>
      <main className="co-main">{children}</main>
    </div>
  );
}

const ICON: Record<PayStatus, ReactNode> = {
  pending: <Clock />, submitted: <Hourglass />, processing: <RotateCcw />, paid: <CheckCircle2 />, failed: <ShieldAlert />,
  expired: <XCircle />, cancelled: <Ban />, refunded: <Undo2 />, partially_refunded: <Undo2 />,
};
export function StatusPill({ status }: { status: PayStatus }) {
  return <span className={`co-pill ${STATUS_TONE(status)}`}>{STATUS_LABEL[status]}</span>;
}
/** The big result banner: what happened to the payment, in words the customer can act on. */
export function StatusBanner({ payment }: { payment: OrderPayment }) {
  return (
    <div className={`co-banner ${STATUS_TONE(payment.status)}`} role="status">
      <span className="co-banner-ic">{ICON[payment.status]}</span>
      <div><b>Payment {STATUS_LABEL[payment.status].toLowerCase()}</b><p>{STATUS_HINT(payment)}</p></div>
    </div>
  );
}
