import { requireSupabase } from "./supabase";

export const BUCKET = "product-images";
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_SIDE = 1200;
const MAX_FILE = 15 * 1024 * 1024;

export function checkImage(file: File): string | null {
  if (!IMAGE_ACCEPT.split(",").includes(file.type)) return "Choose a JPG, PNG or WebP image.";
  if (file.size > MAX_FILE) return "That image is larger than 15 MB. Choose a smaller one.";
  return null;
}

const toBlob = (canvas: HTMLCanvasElement, type: string) => new Promise<Blob | null>(res => canvas.toBlob(res, type, 0.85));

/** Phone photos are huge; shrink them so the public catalogue stays fast. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const webp = await toBlob(canvas, "image/webp");
    if (webp && webp.type === "image/webp") return webp;
    return (await toBlob(canvas, "image/jpeg")) ?? file;
  } catch { return file; }
}

export async function uploadProductImage(file: File): Promise<string> {
  const problem = checkImage(file);
  if (problem) throw new Error(problem);
  const blob = await shrink(file);
  const ext = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/png" ? "png" : "webp";
  const path = `${crypto.randomUUID()}.${ext}`;
  const storage = requireSupabase().storage.from(BUCKET);
  const { error } = await storage.upload(path, blob, { contentType: blob.type || file.type, cacheControl: "31536000" });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error("Image storage is not set up yet. Run supabase/migrations/0002_product_images.sql in the Supabase SQL Editor.");
    if (/row-level security|policy/i.test(error.message)) throw new Error("Your role is not allowed to upload product images.");
    throw new Error(error.message);
  }
  return storage.getPublicUrl(path).data.publicUrl;
}

/** Best effort: delete an uploaded image that is no longer used. Links to other sites are left alone. */
export async function removeProductImage(url: string | null | undefined) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = url ? url.indexOf(marker) : -1;
  if (!url || at < 0) return;
  try { await requireSupabase().storage.from(BUCKET).remove([decodeURIComponent(url.slice(at + marker.length).split("?")[0])]); } catch { /* ignore */ }
}
