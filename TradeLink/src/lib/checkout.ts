import { requireSupabase } from "./supabase";

export type PayMethod = "bank_transfer" | "cod" | "telebirr" | "ebirr";
/** Methods where the customer sends money to our account and staff then verify it. */
export const isTransfer = (m: PayMethod) => m !== "cod";
export type PayStatus = "pending" | "submitted" | "processing" | "paid" | "failed" | "expired" | "cancelled" | "refunded" | "partially_refunded";
export type CheckoutOptions = { cod: boolean; bank: boolean; telebirr: boolean; ebirr: boolean; delivery_fee: number; free_delivery_over: number | null };
export type OrderPayment = {
  method: PayMethod; status: PayStatus; amount: number; currency: string; reference: string; customer_txn_ref: string | null; has_proof: boolean;
  review_note: string | null; paid_at: string | null; bank: { bank_name: string; account_name: string; account_number: string; note: string | null } | null;
};
export type OrderView = {
  order_number: string; status: string; created_at: string; customer_name: string; delivery_location: string; delivery_fee: number; total: number; paid: number;
  items: { name: string; quantity: number; unit: string; unit_price: number; line_total: number }[];
  delivery_status: string | null; payment: OrderPayment | null;
  payments: { method: PayMethod; status: PayStatus; amount: number; reference: string; created_at: string; paid_at: string | null }[];
};

export const STATUS_LABEL: Record<PayStatus, string> = {
  pending: "Pending", submitted: "Submitted", processing: "Processing", paid: "Paid", failed: "Failed", expired: "Expired", cancelled: "Cancelled",
  refunded: "Refunded", partially_refunded: "Partially refunded",
};
export const METHOD_LABEL: Record<PayMethod, string> = { bank_transfer: "Bank transfer (CBE)", cod: "Cash on Delivery", telebirr: "Telebirr", ebirr: "eBirr" };
export const STATUS_TONE = (s: PayStatus) => (s === "paid" ? "good" : s === "failed" || s === "expired" || s === "cancelled" ? "bad" : s === "refunded" || s === "partially_refunded" ? "info" : "warn");
/** What the customer should understand about each status. */
export const STATUS_HINT = (p: OrderPayment): string => {
  switch (p.status) {
    case "pending": return p.method === "cod" ? "Pay the delivery person in cash when your order arrives." : "Send the payment, then enter its reference below.";
    case "submitted": return "We received your payment details. We are checking that the money arrived; this is not confirmed yet.";
    case "processing": return "Your payment is being processed.";
    case "paid": return p.method === "cod" ? "Cash received. Thank you." : "Payment confirmed. Thank you.";
    case "failed": return p.review_note ? `We could not confirm the payment: ${p.review_note}` : "We could not confirm the payment. Please send the details again.";
    case "expired": return "No payment was reported in time, so the order was cancelled. You can place a new order.";
    case "cancelled": return "This payment was cancelled.";
    case "refunded": return "This payment was refunded.";
    case "partially_refunded": return "Part of this payment was refunded.";
  }
};

const KEY = "tradelink-checkout";
export type CheckoutItem = { product_id: string; quantity: number };
export const saveCheckoutCart = (items: CheckoutItem[]) => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage unavailable */ } };
export const loadCheckoutCart = (): CheckoutItem[] => { try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
export const clearCheckoutCart = () => { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } };
/** A retry of the same checkout reuses this key, so a double tap can never create two orders. */
const IDEM = "tradelink-checkout-key";
export const checkoutKey = (fresh = false) => {
  try { let k = fresh ? null : sessionStorage.getItem(IDEM); if (!k) { k = `co-${crypto.randomUUID()}`; sessionStorage.setItem(IDEM, k); } return k; } catch { return `co-${Math.random().toString(36).slice(2)}${Date.now()}xx`; }
};
export const resetCheckoutKey = () => { try { sessionStorage.removeItem(IDEM); } catch { /* storage unavailable */ } };

const rpc = async <T,>(name: string, args?: Record<string, unknown>): Promise<T> => {
  const { data, error } = await requireSupabase().rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
};
export const fetchCheckoutOptions = () => rpc<CheckoutOptions>("checkout_options");
export const placeOrder = (a: { items: CheckoutItem[]; name: string; phone: string; email: string; location: string; notes: string; method: PayMethod; key: string; website: string }) =>
  rpc<{ order_number: string; payment_reference: string; total: number; method?: PayMethod; repeat: boolean }>("place_order", {
    p_items: a.items, p_name: a.name, p_phone: a.phone, p_email: a.email, p_location: a.location, p_notes: a.notes, p_method: a.method, p_key: a.key, p_website: a.website,
  });
export const trackOrder = (number: string, phone: string) => rpc<OrderView>("track_order", { p_number: number, p_phone: phone });
/** Who this device ordered as. Kept so a refresh, or coming back later, still shows the customer's orders. */
const WHO = "tradelink-customer";
export type Identity = { name: string; phone: string };
export const saveIdentity = (i: Identity) => { try { localStorage.setItem(WHO, JSON.stringify(i)); } catch { /* storage unavailable */ } };
export const loadIdentity = (): Identity | null => { try { const v = JSON.parse(localStorage.getItem(WHO) ?? "null"); return v && typeof v.name === "string" && typeof v.phone === "string" ? v : null; } catch { return null; } };
export const clearIdentity = () => { try { localStorage.removeItem(WHO); } catch { /* storage unavailable */ } };
export const ordersByContact = (name: string, phone: string) => rpc<OrderView[]>("orders_by_contact", { p_name: name, p_phone: phone });
export const myOrders = () => rpc<OrderView[]>("my_orders");
export const submitProof = (number: string, phone: string, txn: string, proof: string | null) => rpc<OrderView>("submit_payment_proof", { p_number: number, p_phone: phone, p_txn_ref: txn, p_proof: proof });

/** Uploads a receipt photo or PDF to the private bucket and returns its stored file name. Staff open it to compare with the bank; it is never proof on its own. */
export async function uploadProof(file: File): Promise<string> {
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/jpeg" ? "jpg" : "";
  if (!ext) throw new Error("Attach a photo (JPG, PNG, WebP) or a PDF.");
  if (file.size > 5 * 1024 * 1024) throw new Error("The file is too large (5 MB max).");
  const name = `${crypto.randomUUID()}.${ext}`;
  const { error } = await requireSupabase().storage.from("payment-proofs").upload(name, file, { contentType: file.type, upsert: false });
  if (error) throw new Error("Could not upload the receipt. You can still enter the transaction reference.");
  return name;
}
