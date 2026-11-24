import { useState } from "react";
import { CheckCircle2, Copy, Printer, Share2, X } from "lucide-react";
import "./payoutReceipt.css";

export type PayoutRec = { id: string; supplier_name: string; amount: number; method: string; reference: string | null; note: string | null; paid_at: string };
export const payoutNo = (id: string) => `PAY-${id.slice(0, 8).toUpperCase()}`;
const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", mobile_money: "Mobile money", cash: "Cash" };
const etb = (n: number) => `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ETB`;
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

function lines(r: PayoutRec): [string, string][] {
  return [["Receipt no.", payoutNo(r.id)], ["Date", when(r.paid_at)], ["Paid to", r.supplier_name], ["Method", METHOD[r.method] ?? r.method],
    ...(r.reference ? [["Reference", r.reference] as [string, string]] : []), ...(r.note ? [["Note", r.note] as [string, string]] : [])];
}
const text = (r: PayoutRec) => `TradeLink payment receipt ${payoutNo(r.id)}\nPaid to: ${r.supplier_name}\nAmount: ${etb(r.amount)}\nMethod: ${METHOD[r.method] ?? r.method}${r.reference ? `\nReference: ${r.reference}` : ""}\nDate: ${when(r.paid_at)}`;

/** Prints only the receipt (works as "Save as PDF" too). */
function print(r: PayoutRec) {
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(f);
  const d = f.contentDocument!;
  d.open();
  d.write(`<!doctype html><title>${payoutNo(r.id)}</title><style>body{font:15px system-ui,sans-serif;color:#0f2c4c;margin:32px;max-width:520px}h1{font-size:20px;margin:0}.h{border-bottom:3px solid #0b4f86;padding-bottom:12px;margin-bottom:18px}.a{font-size:30px;font-weight:800;margin:14px 0}.r{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #e3ebf5}.r span{color:#5b7890}.f{margin-top:22px;color:#5b7890;font-size:12.5px}</style><div class="h"><h1>TradeLink</h1><div>Supplier payment receipt</div></div><div>Amount paid</div><div class="a">${esc(etb(r.amount))}</div>${lines(r).map(([k, v]) => `<div class="r"><span>${k}</span><b>${esc(v)}</b></div>`).join("")}<p class="f">This receipt confirms TradeLink recorded this payment to the supplier above.</p>`);
  d.close();
  f.contentWindow!.focus();
  setTimeout(() => { f.contentWindow!.print(); setTimeout(() => f.remove(), 1500); }, 250);
}

export default function PayoutReceipt({ r, onClose }: { r: PayoutRec; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const share = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: `Receipt ${payoutNo(r.id)}`, text: text(r) }); return; }
      await navigator.clipboard.writeText(text(r)); setMsg("Receipt text copied. Paste it into WhatsApp or SMS.");
    } catch { /* cancelled */ }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(text(r)); setMsg("Copied."); } catch { setMsg("Could not copy."); } };
  return (
    <div className="prc-back" role="dialog" aria-modal="true" aria-label="Payment receipt" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prc">
        <button className="prc-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <div className="prc-top"><span><CheckCircle2 size={26} /></span><small>Payment receipt</small><b>{etb(r.amount)}</b><em>{r.supplier_name}</em></div>
        <dl>{lines(r).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        {msg && <p className="prc-msg" role="status">{msg}</p>}
        <div className="prc-acts">
          <button className="prc-b main" onClick={() => print(r)}><Printer size={16} /> Print / PDF</button>
          <button className="prc-b" onClick={() => void share()}><Share2 size={16} /> Send</button>
          <button className="prc-b icon" aria-label="Copy receipt text" onClick={() => void copy()}><Copy size={16} /></button>
        </div>
      </div>
    </div>
  );
}
