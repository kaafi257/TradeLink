import { useState } from "react";
import { Form, Modal, callRpc, useAction } from "../suite";

export type Due = { payment_id: string; order_number: string; customer_name: string; delivery_location: string; amount: number; delivery_status: string };

export function CashModal({ due, onClose, onDone }: { due: Due; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [amount, setAmount] = useState(String(Number(due.amount)));
  return (
    <Modal title={`Cash for ${due.order_number}`} kicker="CASH ON DELIVERY" onClose={onClose}>
      <p className="su-muted">{due.customer_name}. Confirm only after you have the cash in your hand. The amount must equal what is due.</p>
      <Form onSubmit={() => void run(() => callRpc("confirm_cod_collection", { p_payment: due.payment_id, p_amount: Number(amount) }), "Cash confirmed.").then(ok => { if (ok) onDone(); })} busy={busy} submit="Cash received">
        <label>Amount collected (ETB)<input type="number" min="0.01" step="0.01" required value={amount} onChange={e => setAmount(e.target.value)} /></label>
      </Form>
    </Modal>
  );
}

