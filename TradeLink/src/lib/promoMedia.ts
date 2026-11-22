import { requireSupabase } from "./supabase";

const BUCKET = "promo-media";
export const MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/webm";
const MAX_IMAGE = 15 * 1024 * 1024;
const MAX_VIDEO = 60 * 1024 * 1024;

export const isVideoUrl = (u: string | null | undefined) => !!u && /\.(mp4|webm)(\?|$)/i.test(u);

export function checkMedia(file: File): string | null {
  const types = MEDIA_ACCEPT.split(",");
  if (!types.includes(file.type)) return "Choose a JPG, PNG or WebP picture, or an MP4 or WebM video.";
  if (file.type.startsWith("video/") ? file.size > MAX_VIDEO : file.size > MAX_IMAGE) return file.type.startsWith("video/") ? "That video is larger than 60 MB. Choose a shorter one." : "That picture is larger than 15 MB. Choose a smaller one.";
  return null;
}

/** Uploads as it is (no shrinking) so the homepage picture or video stays sharp. */
export async function uploadPromoMedia(file: File): Promise<string> {
  const problem = checkMedia(file);
  if (problem) throw new Error(problem);
  const ext = file.type === "video/mp4" ? "mp4" : file.type === "video/webm" ? "webm" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${crypto.randomUUID()}.${ext}`;
  const storage = requireSupabase().storage.from(BUCKET);
  const { error } = await storage.upload(path, file, { contentType: file.type, cacheControl: "31536000" });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error("Advertising media storage is not set up yet. Run supabase/migrations/0023_promotion_media.sql in the Supabase SQL Editor.");
    if (/row-level security|policy/i.test(error.message)) throw new Error("Your role is not allowed to upload advertising media.");
    throw new Error(error.message);
  }
  return storage.getPublicUrl(path).data.publicUrl;
}

/** Best effort: delete an uploaded file that is no longer used. */
export async function removePromoMedia(url: string | null | undefined) {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const at = url ? url.indexOf(marker) : -1;
  if (!url || at < 0) return;
  try { await requireSupabase().storage.from(BUCKET).remove([decodeURIComponent(url.slice(at + marker.length).split("?")[0])]); } catch { /* ignore */ }
}
