import { useEffect, useState } from "react";
import { Copy, KeyRound, Lock } from "lucide-react";
import { readOrderCode, trackOrderCode, type CodeView } from "../../lib/checkout";

/** The customer's delivery code. It lives on the phone that placed the order; the driver asks for it at the door and the order is only
 *  completed when it is entered. Older orders without a saved code get it shown here while the order is on the way. */
export default function OrderCode({ number, phone, deliveryStatus }: { number: string; phone: string; deliveryStatus: string | null }) {
  const saved = readOrderCode(number);
  const [view, setView] = useState<CodeView | null>(null);
  const [copied, setCopied] = useState(false);
  const onTheWay = deliveryStatus === "in_transit";
  useEffect(() => {
    if (saved || !onTheWay || !phone) return;
    let stop = false;
    const load = async () => { try { const v = await trackOrderCode(number, phone); if (!stop) setView(v); } catch { /* keep the last answer */ } };
    void load();
    const id = window.setInterval(() => void load(), 15000);
    return () => { stop = true; window.clearInterval(id); };
  }, [number, phone, saved, onTheWay]);

  const code = saved || (view?.state === "show" ? view.code ?? "" : "");
  if (deliveryStatus === "delivered") return null;
  if (!code && !(onTheWay && view && view.state !== "none")) return null;
  const spaced = code ? `${code.slice(0, 3)} ${code.slice(3)}` : "";
  return (
    <section className="co-card co-code" aria-label="Delivery code">
      <h2><KeyRound size={18} style={{ verticalAlign: -3 }} /> Your delivery code</h2>
      {code ? (
        <>
          <div className="co-code-row">
            <strong aria-label={`Code ${code.split("").join(" ")}`}>{spaced}</strong>
            <button type="button" className="co-copy" aria-label="Copy the code" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }); }}><Copy size={16} />{copied ? " Copied" : ""}</button>
          </div>
          <p className="co-note">Tell the driver this code <b>only after you have received your order</b>. Keep it private until then.</p>
        </>
      ) : view?.state === "locked" ? (
        <p className="co-note"><Lock size={15} /> Too many wrong codes were entered for this delivery. Please call TradeLink and we will give you a new code.</p>
      ) : view?.state === "expired" ? (
        <p className="co-note">This code has expired. Please call TradeLink and we will give you a new one.</p>
      ) : (
        <p className="co-note">Your code is saved on the phone you ordered from. Can't find it? Call TradeLink and we will give you a new one.</p>
      )}
    </section>
  );
}
