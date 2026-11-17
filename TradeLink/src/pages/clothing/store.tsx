import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase, type ProductImage, type ProductOption, type PublicCategory, type PublicIndustry, type PublicProduct } from "../../lib/supabase";

export type Status = "loading" | "ready" | "error" | "offline" | "empty";
export type CartLine = { productId: string; qty: number; size?: string; color?: string };

export type Fashion = {
  status: Status;
  products: PublicProduct[];
  categories: PublicCategory[];
  /** The industry set to the fashion storefront; its name and description (edited in Admin) head the page. */
  industry: PublicIndustry | null;
  byId: Map<string, PublicProduct>;
  /** Product ids ranked by real sales (empty until something has sold). */
  bestIds: string[];
  catName: (p: PublicProduct) => string;
  photos: (p: PublicProduct) => string[];
  sizes: (id: string) => string[];
  colors: (id: string) => { label: string; hex: string }[];
  // wishlist
  wished: Set<string>;
  toggleWish: (id: string) => void;
  // cart (feeds the existing price-request flow)
  cart: CartLine[];
  addToCart: (line: CartLine) => void;
  setQty: (id: string, qty: number) => void;
  removeFromCart: (id: string) => void;
  clearCart: () => void;
  /** Replace the cart with the lines edited inside the request form (keeps each product's size and colour). */
  syncCart: (lines: { productId: string; qty: number }[]) => void;
  // panels
  panel: null | "cart" | "wishlist" | "search" | "menu";
  openPanel: (p: Fashion["panel"]) => void;
  quick: PublicProduct | null;
  setQuick: (p: PublicProduct | null) => void;
  requestOpen: boolean;
  setRequestOpen: (v: boolean) => void;
};

const Ctx = createContext<Fashion | null>(null);
export const useFashion = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFashion must be used inside <FashionProvider>");
  return v;
};

const WISH_KEY = "tradelink-wishlist";
const CART_KEY = "tradelink-fashion-cart";
const read = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };
const write = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ } };
const forIndividuals = (p: PublicProduct) => (p.audience ?? "both") !== "b2b";

export function FashionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(supabase ? "loading" : "offline");
  const [products, setProducts] = useState<PublicProduct[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [industry, setIndustry] = useState<PublicIndustry | null>(null);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [bestIds, setBestIds] = useState<string[]>([]);
  const [wishIds, setWishIds] = useState<string[]>(() => read<string[]>(WISH_KEY, []));
  const [cart, setCart] = useState<CartLine[]>(() => read<CartLine[]>(CART_KEY, []));
  const [panel, setPanel] = useState<Fashion["panel"]>(null);
  const [quick, setQuick] = useState<PublicProduct | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    (async () => {
      const [ind, cat, prod] = await Promise.all([
        supabase.from("public_industries").select("*"),
        supabase.from("public_categories").select("*").order("sort_order").order("name"),
        supabase.from("public_products").select("*").order("created_at", { ascending: false }),
      ]);
      if (!live) return;
      if (prod.error || cat.error || ind.error) { setStatus("error"); return; }
      const fashion = ((ind.data ?? []) as PublicIndustry[]).filter(i => i.storefront === "fashion");
      const fashionIds = new Set(fashion.map(i => i.id));
      setIndustry(fashion[0] ?? null);
      const cats = ((cat.data ?? []) as PublicCategory[]).filter(c => fashionIds.has(c.industry_id));
      const catIds = new Set(cats.map(c => c.id));
      const prods = ((prod.data ?? []) as PublicProduct[]).filter(p => p.category_id && catIds.has(p.category_id) && forIndividuals(p));
      setCategories(cats);
      setProducts(prods);
      setStatus(prods.length ? "ready" : "empty");
      if (!prods.length) return;
      // Gallery and options come from migration 0006; if the views are missing the shop still works with the main photo.
      const [im, op, best] = await Promise.all([
        supabase.from("public_product_images").select("*").order("sort_order"),
        supabase.from("public_product_options").select("*").order("sort_order"),
        supabase.from("public_best_sellers").select("*").order("rank"),
      ]);
      if (!live) return;
      if (!im.error) setImages((im.data ?? []) as ProductImage[]);
      if (!op.error) setOptions((op.data ?? []) as ProductOption[]);
      if (!best.error) setBestIds(((best.data ?? []) as { product_id: string }[]).map(b => b.product_id));
    })();
    return () => { live = false; };
  }, []);

  const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);
  const imgMap = useMemo(() => { const m = new Map<string, string[]>(); for (const i of images) m.set(i.product_id, [...(m.get(i.product_id) ?? []), i.url]); return m; }, [images]);
  const optMap = useMemo(() => { const m = new Map<string, ProductOption[]>(); for (const o of options) m.set(o.product_id, [...(m.get(o.product_id) ?? []), o]); return m; }, [options]);

  // Forget wishlist / cart entries whose product is gone (deactivated or deleted by an admin).
  useEffect(() => {
    if (status !== "ready" && status !== "empty") return;
    setWishIds(w => { const n = w.filter(id => byId.has(id)); return n.length === w.length ? w : n; });
    setCart(c => { const n = c.filter(l => byId.has(l.productId)); return n.length === c.length ? c : n; });
  }, [status, byId]);
  useEffect(() => { write(WISH_KEY, wishIds); }, [wishIds]);
  useEffect(() => { write(CART_KEY, cart); }, [cart]);

  const value = useMemo<Fashion>(() => ({
    status, products, categories, industry, byId, bestIds,
    catName: p => (p.category_id && catById.get(p.category_id)?.name) || p.category,
    photos: p => Array.from(new Set([p.image_url, ...(imgMap.get(p.id) ?? [])].filter((u): u is string => !!u))),
    sizes: id => (optMap.get(id) ?? []).filter(o => o.kind === "size").map(o => o.label),
    colors: id => (optMap.get(id) ?? []).filter(o => o.kind === "color").map(o => ({ label: o.label, hex: o.color_hex || "#111111" })),
    wished: new Set(wishIds),
    toggleWish: id => setWishIds(w => (w.includes(id) ? w.filter(x => x !== id) : [...w, id])),
    cart,
    addToCart: line => setCart(c => (c.some(l => l.productId === line.productId) ? c.map(l => (l.productId === line.productId ? line : l)) : [...c, line])),
    setQty: (id, qty) => setCart(c => c.map(l => (l.productId === id ? { ...l, qty: Math.max(1, Math.min(99, Math.round(qty) || 1)) } : l))),
    removeFromCart: id => setCart(c => c.filter(l => l.productId !== id)),
    clearCart: () => setCart([]),
    syncCart: lines => setCart(c => lines.map(l => { const old = c.find(x => x.productId === l.productId); return { productId: l.productId, qty: l.qty, size: old?.size, color: old?.color }; })),
    panel, openPanel: setPanel, quick, setQuick, requestOpen, setRequestOpen,
  }), [status, products, categories, industry, byId, bestIds, catById, imgMap, optMap, wishIds, cart, panel, quick, requestOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Price shown to customers: the sale price when there is one, with the original kept for the strike-through. */
export function priceOf(p: PublicProduct) {
  const retail = p.retail_price && p.retail_price > 0 ? Number(p.retail_price) : null;
  const sale = retail !== null && p.sale_price && Number(p.sale_price) > 0 && Number(p.sale_price) < retail ? Number(p.sale_price) : null;
  return { now: sale ?? retail, was: sale !== null ? retail : null, onSale: sale !== null };
}

/** "Selected size / colour" text carried into the request notes. */
export const optionText = (l: { size?: string; color?: string }) => [l.size && `Size ${l.size}`, l.color && `Colour ${l.color}`].filter(Boolean).join(", ");

export const useScrollLock = (on: boolean) => {
  useEffect(() => {
    if (!on) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [on]);
};

export const useEscape = (on: boolean, fn: () => void) => {
  const stable = useCallback(fn, [fn]);
  useEffect(() => {
    if (!on) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") stable(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [on, stable]);
};
