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

export type Role = "owner" | "manager" | "sales" | "inventory" | "delivery" | "staff" | "supplier";
export type Profile = { id: string; full_name: string; email: string; role: Role; active: boolean };
export type Product = {
  id: string; name: string; category: string; sku: string | null; description: string | null;
  image_url: string | null; unit: string; package_size: string | null; wholesale_price: number;
  min_order_quantity: number; stock_quantity: number; reorder_level: number; active: boolean; created_at: string;
  category_id: string | null; retail_price: number; audience: Audience;
  /** Fashion fields (migration 0006); missing until that migration has been run. */
  brand?: string | null; sale_price?: number | null;
};
export type Audience = "b2b" | "b2c" | "both";
export type Storefront = "standard" | "fashion";
export type Industry = { id: string; name: string; description: string | null; icon: string; sort_order: number; active: boolean; storefront?: Storefront };
export type Category = { id: string; industry_id: string; name: string; description: string | null; image_url: string | null; sort_order: number; active: boolean };
export type PublicIndustry = Pick<Industry, "id" | "name" | "description" | "icon" | "sort_order" | "storefront">;
export type PublicCategory = Pick<Category, "id" | "industry_id" | "name" | "description" | "image_url" | "sort_order">;
/** What the public website may see (the public_products view): no price, stock or SKU. */
export type PublicProduct = {
  id: string; name: string; category: string; description: string | null; image_url: string | null;
  unit: string; package_size: string | null; min_order_quantity: number;
  category_id: string | null; audience: Audience; retail_price: number | null;
  /** Added by migration 0006 (fashion storefront). */
  brand?: string | null; sale_price?: number | null; created_at?: string;
  stock_status?: "in" | "low" | "out"; stock_left?: number | null;
};
/** Suppliers directory (migration 0007). Only the harmless public fields are ever read by the website. */
export type SupplierStatus = "pending" | "approved" | "rejected" | "suspended";
export type BusinessType = "manufacturer" | "wholesaler" | "distributor" | "importer" | "retailer" | "farmer" | "service" | "other";
export type SupplierDocument = { path: string; name: string; uploaded_at: string };
export type Supplier = {
  id: string; name: string; industry_id: string; location: string | null; about: string | null; active: boolean; created_at: string;
  /** Supplier-account fields (migration 0009). */
  profile_id?: string | null; status?: SupplierStatus; owner_name?: string | null; phone?: string | null; email?: string | null;
  address?: string | null; business_type?: BusinessType | null; logo_path?: string | null; documents?: SupplierDocument[];
  status_note?: string | null; reviewed_at?: string | null; fee_rate?: number;
};
export type AppNotification = { id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string };
export type PublicSupplier = Pick<Supplier, "id" | "name" | "industry_id" | "location" | "about"> & { logo_path?: string | null };
export type ProductImage = { id: string; product_id: string; url: string; sort_order: number };
export type ProductOption = { id: string; product_id: string; kind: "size" | "color"; label: string; color_hex: string | null; sort_order: number };
export type QuoteItem = { id: string; product_name: string; quantity: number; unit: string; unit_price: number };
export type Quote = {
  id: string; quote_number: string; customer_name: string; phone: string; email: string | null;
  delivery_location: string; status: string; notes: string | null; created_at: string;
  estimated_total: number; customer_type?: "business" | "individual";
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
  { key: "catalogue.manage", label: "Manage industries and categories" },
  { key: "reports.view", label: "View business reports" },
  { key: "reports.sensitive", label: "See full customer phone and email in reports" },
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
