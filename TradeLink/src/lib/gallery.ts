import { useEffect, useState } from "react";
import { supabase, type PublicProduct } from "./supabase";

const cache = new Map<string, string[]>();

/**
 * Every photo of a product, in the order the team set: the main image first, then the extra photos
 * (public_product_images, sorted by sort_order). Before the extra-photos migration, or when it fails, only the main image is shown.
 */
export function useProductImages(p: PublicProduct): string[] {
  const [extra, setExtra] = useState<string[]>(cache.get(p.id) ?? []);
  useEffect(() => {
    if (!supabase || cache.has(p.id)) { setExtra(cache.get(p.id) ?? []); return; }
    let live = true;
    void supabase.from("public_product_images").select("url, sort_order").eq("product_id", p.id).order("sort_order").then(r => {
      if (r.error) return;
      const urls = ((r.data ?? []) as { url: string }[]).map(x => x.url);
      cache.set(p.id, urls);
      if (live) setExtra(urls);
    });
    return () => { live = false; };
  }, [p.id]);
  const all = [p.image_url, ...extra].filter((u): u is string => !!u);
  return Array.from(new Set(all));
}
