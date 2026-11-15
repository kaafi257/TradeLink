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
export type QuoteItem = { product_name: string; quantity: number; unit: string };
export type Quote = {
  id: string; quote_number: string; customer_name: string; phone: string; email: string | null;
  delivery_location: string; status: string; notes: string | null; created_at: string;
  quotation_items?: QuoteItem[];
};
/** Daily sales total from the sales_by_day() database function. */
export type SalesPoint = { sold_at: string; total_amount: number };
export type SaleRow = { id: string; receipt_number: string; customer_name: string; total_amount: number; amount_paid: number; payment_method: string | null; sold_at: string };
export type Activity = { id: string; action: string; entity_type: string; description: string; created_at: string; actor_name: string | null };

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Add your project URL and publishable key to .env.local.");
  return supabase;
}

// Activity logging is done by database triggers, so the browser never writes to activity_logs.
