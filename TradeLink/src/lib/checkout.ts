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
export const shareOrderLocation = (number: string, phone: string, f: { lat: number; lng: number; accuracy: number }) =>
  rpc("set_order_location", { p_number: number, p_phone: phone, p_lat: f.lat, p_lng: f.lng, p_accuracy: f.accuracy });
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

/** Phone photos are often 5-10 MB. Shrink them to a sharp JPEG of about 1 MB before sending; PDFs pass through (1.5 MB max). */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || (file.size <= 0.9 * 1024 * 1024 && file.type === "image/jpeg")) return file;
  try {
    const bmp = await createImageBitmap(file);
    for (const [max, q] of [[1800, 0.85], [1500, 0.75], [1200, 0.7], [900, 0.65]] as const) {
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      const ctx = c.getContext("2d"); if (!ctx) return file;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/jpeg", q));
      if (blob && blob.size <= 1.4 * 1024 * 1024) { bmp.close?.(); return new File([blob], "receipt.jpg", { type: "image/jpeg" }); }
    }
    bmp.close?.(); return file;
  } catch { return file; }
}
const guessType = (f: File) => f.type || (/\.pdf$/i.test(f.name) ? "application/pdf" : /\.png$/i.test(f.name) ? "image/png" : /\.webp$/i.test(f.name) ? "image/webp" : /\.jpe?g$/i.test(f.name) ? "image/jpeg" : "");
const toBase64 = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = () => rej(new Error("Could not read the file.")); r.readAsDataURL(f); });

/** Sends the receipt photo or PDF through the database (no storage permissions involved) and returns its id. Staff open it to compare with the bank; it is never proof on its own. */
export async function uploadProof(original: File, orderNumber: string, phone: string): Promise<string> {
  const typed = original.type ? original : new File([original], original.name, { type: guessType(original) });
  const file = await shrinkImage(typed);
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new Error("Attach a photo (JPG, PNG, WebP) or a PDF.");
  if (file.size > 1.5 * 1024 * 1024) throw new Error("The file is too large. Take a screenshot of the receipt and attach that.");
  return rpc<string>("upload_payment_receipt", { p_number: orderNumber, p_phone: phone, p_content_type: file.type, p_data: await toBase64(file) });
}

/** Cities (and optional areas) the customer can choose at checkout. Empty until the owner adds cities, and then checkout works as before. */
export type CityOption = { id: string; name: string; zones: { id: string; name: string }[] };
export const fetchCities = () => rpc<CityOption[]>("public_cities").then(v => (Array.isArray(v) ? v : []));
export const shareOrderCity = (number: string, phone: string, city: string, zone: string | null) =>
  rpc("set_order_city", { p_number: number, p_phone: phone, p_city: city, p_zone: zone });
