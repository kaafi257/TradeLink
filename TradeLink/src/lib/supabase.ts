import { createClient } from "@supabase/supabase-js";

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
export type QuoteItem = { product_name: string; quantity: number; unit: string };
export type Quote = {
  id: string; quote_number: string; customer_name: string; phone: string; email: string | null;
  delivery_location: string; status: string; notes: string | null; created_at: string;
  quotation_items?: QuoteItem[];
};
export type SaleRow = { id: string; receipt_number: string; customer_name: string; total_amount: number; amount_paid: number; payment_method: string | null; sold_at: string };
export type Activity = { id: string; action: string; entity_type: string; description: string; created_at: string; actor_name: string | null };

export function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Add your project URL and publishable key to .env.local.");
  return supabase;
}

/** The database stamps the actor (who did it) itself; the browser only describes what happened. */
export async function logActivity(action: string, entityType: string, description: string) {
  if (!supabase) return;
  await supabase.from("activity_logs").insert({ action, entity_type: entityType, description });
}
