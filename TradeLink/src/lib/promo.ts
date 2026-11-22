import { requireSupabase } from "./supabase";

export type PromoStatus = "draft" | "pending" | "scheduled" | "active" | "paused" | "expired";
export type PromoKind = "sale" | "flash" | "bogo";
export type Promo = {
  id: string; name: string; kind: PromoKind; scope: "all" | "category" | "product" | "store"; owner: "store" | "supplier";
  supplier_id: string | null; category_id: string | null; product_id: string | null;
  discount_type: "percent" | "fixed"; percent: number | null; amount: number | null; max_discount: number | null; buy_qty: number | null; get_qty: number | null;
  starts_at: string | null; ends_at: string | null; started_at: string | null; status: PromoStatus; note: string | null; review_note: string | null;
  show_banner: boolean; banner_text: string | null; media_url?: string | null; paused_by: string | null; created_at: string; submitted_at: string | null;
  promotion_items?: { product_id: string }[];
};
export type Coupon = {
  id: string; code: string; name: string | null; discount_type: "percent" | "fixed"; percent: number | null; amount: number | null; min_order: number | null; max_discount: number | null;
  max_uses: number | null; starts_at: string | null; ends_at: string | null; active: boolean; approval: "draft" | "pending" | "approved"; owner: "store" | "supplier";
  supplier_id: string | null; review_note: string | null; created_at: string;
};
export type PromoResult = { promotion_id: string; units: number; revenue: number; orders: number; free_units: number };
export type CouponResult = { coupon_id: string; uses: number; orders: number; discount: number; revenue: number };
/** What the public site may see of a live campaign. */
export type PublicPromo = Pick<Promo, "id" | "name" | "kind" | "scope" | "supplier_id" | "category_id" | "product_id" | "discount_type" | "percent" | "amount" | "max_discount" | "buy_qty" | "get_qty" | "starts_at" | "ends_at" | "started_at" | "show_banner" | "banner_text" | "media_url">;

export const STATUS_LABEL: Record<PromoStatus, string> = { draft: "Draft", pending: "Pending approval", scheduled: "Scheduled", active: "Active", paused: "Paused", expired: "Expired" };
export const KIND_LABEL: Record<PromoKind, string> = { sale: "Sale", flash: "Flash sale", bogo: "Buy X Get Y" };
export const STATUS_ORDER: PromoStatus[] = ["active", "scheduled", "pending", "paused", "draft", "expired"];

export const etb = (n: unknown) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0)} ETB`;
export const whenText = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** The big headline of a campaign: "20% off", "ETB 50 off", "Buy 2 Get 1". */
export function offerText(p: Pick<Promo, "kind" | "discount_type" | "percent" | "amount" | "buy_qty" | "get_qty">) {
  if (p.kind === "bogo") return `Buy ${p.buy_qty} Get ${p.get_qty}`;
  return p.discount_type === "percent" ? `${Number(p.percent)}% off` : `${etb(p.amount)} off`;
}
export function offerSub(p: Pick<Promo, "kind" | "discount_type" | "max_discount" | "get_qty">) {
  if (p.kind === "bogo") return `${p.get_qty} free`;
  return p.max_discount ? `up to ${etb(p.max_discount)} off each` : p.discount_type === "fixed" ? "off each unit" : "";
}
export function couponOffer(c: Pick<Coupon, "discount_type" | "percent" | "amount">) {
  return c.discount_type === "percent" ? `${Number(c.percent)}% off` : `${etb(c.amount)} off`;
}
export function windowText(p: { starts_at: string | null; ends_at: string | null; started_at?: string | null }) {
  const from = p.starts_at ?? p.started_at ?? null;
  if (!from && !p.ends_at) return "Starts when you press Start";
  return `${from ? whenText(from) : "Now"} → ${p.ends_at ? whenText(p.ends_at) : "no end"}`;
}

/** A coupon's status is worked out from its approval, switch and dates (there is no separate stored status). */
export function couponStatus(c: Coupon, used = 0): PromoStatus {
  if (c.approval === "draft") return "draft";
  if (c.approval === "pending") return "pending";
  if (!c.active) return "paused";
  if ((c.ends_at && new Date(c.ends_at) <= new Date()) || (c.max_uses && used >= c.max_uses)) return "expired";
  if (c.starts_at && new Date(c.starts_at) > new Date()) return "scheduled";
  return "active";
}

/** datetime-local value from an ISO time, and back. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Calls a database function and throws the message it raised (these are written for people to read). */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().rpc(fn, args ?? {});
  if (error) throw new Error(error.message || "Something went wrong. Please try again.");
  return data as T;
}

export function timeLeft(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Ended";
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4), d = Math.floor(h / 24);
  return d >= 1 ? `${d}d ${h % 24}h left` : h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
}
