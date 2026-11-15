import { createClient } from "@supabase/supabase-js";

// Read before the client starts: supabase-js removes the auth tokens from the address bar once it has used them.
const startHash = typeof window !== "undefined" ? window.location.hash : "";
export const arrivedFromEmailLink = /[#&]type=(invite|recovery)\b/.test(startHash);

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key && !url.includes("YOUR-PROJECT"));
export const supabase = isSupabaseConfigured
  ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;

export type Role = "owner" | "manager" | "sales" | "inventory" | "delivery" | "staff";
export type Profile = { id: string; full_name: string; email: string; role: Role; active: boolean };
export type Product = {
  id: string; name: string; category: string; sku: string | null; description: string | null;
  image_url: string | null; unit: string; package_size: string | null; wholesale_price: number;
  min_order_quantity: number; stock_quantity: number; reorder_level: number; active: boolean; created_at: string;
};
/** What the public website may see (the public_products view): no price, stock or SKU. */
export type PublicProduct = {
  id: string; name: string; category: string; description: string | null; image_url: string | null;
  unit: string; package_size: string | null; min_order_quantity: number;
};
export type QuoteItem = { id: string; product_name: string; quantity: number; unit: string; unit_price: number };
export type Quote = {
  id: string; quote_number: string; customer_name: string; phone: string; email: string | null;
  delivery_location: string; status: string; notes: string | null; created_at: string;
  estimated_total: number;
  quotation_items?: QuoteItem[];
};
export type OrderItem = { product_name: string; quantity: number; unit: string; unit_price: number };
export type OrderRow = {
  id: string; order_number: string; quotation_id: string | null; customer_name: string; phone: string; delivery_location: string;
  status: string; total_amount: number; amount_paid: number; created_at: string; order_items?: OrderItem[];
};
export type DeliveryRow = {
  id: string; order_id: string; assigned_to: string | null; status: string; scheduled_at: string | null; delivered_at: string | null;
  notes: string | null; created_at: string; orders?: { order_number: string; customer_name: string; phone: string; delivery_location: string } | null;
};
/** Every action a role can be allowed to do; the database enforces these (see 0003 migration). */
export const PERMISSIONS: { key: string; label: string }[] = [
  { key: "quotes.price", label: "Price quotations" },
  { key: "quotes.convert", label: "Create orders from quotations" },
  { key: "orders.cancel", label: "Cancel orders" },
  { key: "sales.record", label: "Record sales (deducts stock)" },
  { key: "deliveries.assign", label: "Assign and manage any delivery" },
  { key: "deliveries.update", label: "Update own assigned deliveries" },
  { key: "stock.adjust", label: "Adjust stock" },
  { key: "products.edit", label: "Add and edit products" },
];
/** Daily sales total from the sales_by_day() database function. */
export type SalesPoint = { sold_at: string; total_amount: number };
export type SaleRow = { id: string; receipt_number: string; customer_name: string; total_amount: number; amount_paid: number; payment_method: string | null; sold_at: string };
export type Activity = { id: string; action: string; entity_type: string; description: string; created_at: string; actor_name: string | null };

/** Supabase database errors are often plain objects, not Error instances, so read their message directly. */
export function errorText(err: unknown, fallback: string): string {
  const e = err as { message?: unknown; code?: unknown } | null;
  const msg = typeof e?.message === "string" ? e.message : "";
  if (e?.code === "23505") return "A product with that SKU already exists. Use a different SKU or leave it empty.";
  if (e?.code === "42501" || /row-level security|permission denied/i.test(msg)) return "Your role is not allowed to add or edit products.";
  return msg || fallback;
}

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Add your project URL and publishable key to .env.local.");
  return supabase;
}

// Activity logging is done by database triggers, so the browser never writes to activity_logs.
