import { requireSupabase, type SupplierDocument } from "../../lib/supabase";

export const LOGO_ACCEPT = "image/jpeg,image/png,image/webp";
export const DOC_ACCEPT = "application/pdf,image/jpeg,image/png";
export const MAX_DOCS = 8;
const LOGO_MAX = 2 * 1024 * 1024, DOC_MAX = 5 * 1024 * 1024;

export const checkLogo = (f: File) =>
  !LOGO_ACCEPT.split(",").includes(f.type) ? "The logo must be a JPG, PNG or WebP image."
  : f.size > 15 * 1024 * 1024 ? "That logo is larger than 15 MB. Choose a smaller one." : null;
export const checkDoc = (f: File) =>
  !DOC_ACCEPT.split(",").includes(f.type) ? `“${f.name}” must be a PDF, JPG or PNG file.`
  : f.size > DOC_MAX ? `“${f.name}” is larger than 5 MB.` : null;

/** Shrinks a logo so it uploads fast and stays under the 2 MB storage limit. */
async function resizeLogo(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.88));
    return blob && blob.type === "image/webp" && blob.size <= LOGO_MAX ? blob : file.size <= LOGO_MAX ? file : (blob ?? file);
  } catch { return file; }
}

const safe = (name: string) => name.replace(/[^\w.\-]+/g, "_").slice(-80);

/** Uploads the logo to supplier-logos/<supplierId>/ and returns its storage path. */
export async function uploadLogo(supplierId: string, file: File): Promise<string> {
  const problem = checkLogo(file); if (problem) throw new Error(problem);
  const blob = await resizeLogo(file);
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${supplierId}/logo-${Date.now()}.${ext}`;
  const { error } = await requireSupabase().storage.from("supplier-logos").upload(path, blob, { contentType: blob.type || file.type, cacheControl: "31536000" });
  if (error) throw new Error(storageMessage(error.message));
  return path;
}

/** Uploads one business document to the private supplier-documents bucket. */
export async function uploadDocument(supplierId: string, file: File): Promise<SupplierDocument> {
  const problem = checkDoc(file); if (problem) throw new Error(problem);
  const path = `${supplierId}/${Date.now()}-${crypto.randomUUID().slice(0, 6)}-${safe(file.name)}`;
  const { error } = await requireSupabase().storage.from("supplier-documents").upload(path, file, { contentType: file.type });
  if (error) throw new Error(storageMessage(error.message));
  return { path, name: file.name.slice(0, 120), uploaded_at: new Date().toISOString() };
}

export async function removeStored(bucket: "supplier-logos" | "supplier-documents", path: string | null | undefined) {
  if (!path) return;
  try { await requireSupabase().storage.from(bucket).remove([path]); } catch { /* best effort */ }
}

/** Short-lived private link for a business document (owner, manager and the supplier only). */
export async function documentLink(path: string): Promise<string> {
  const { data, error } = await requireSupabase().storage.from("supplier-documents").createSignedUrl(path, 300);
  if (error || !data) throw new Error("Could not open that document.");
  return data.signedUrl;
}

export const logoUrl = (path: string | null | undefined) =>
  path ? requireSupabase().storage.from("supplier-logos").getPublicUrl(path).data.publicUrl : null;

function storageMessage(m: string) {
  if (/bucket not found/i.test(m)) return "File storage for suppliers is not set up yet. Run migration 0009 in Supabase.";
  if (/row-level security|policy/i.test(m)) return "You are not allowed to upload files here.";
  if (/mime|type/i.test(m)) return "That file type is not allowed.";
  if (/size|exceed|large/i.test(m)) return "That file is too large.";
  return m;
}

/* ---------------- product photos (public bucket, one folder per supplier) ---------------- */
async function resizeTo(file: File, max: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close();
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, "image/webp", 0.85));
    return blob && blob.type === "image/webp" && blob.size <= 3 * 1024 * 1024 ? blob : file;
  } catch { return file; }
}
export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export async function uploadProductImage(supplierId: string, file: File): Promise<string> {
  if (!IMAGE_ACCEPT.split(",").includes(file.type)) throw new Error("Photos must be JPG, PNG or WebP images.");
  if (file.size > 15 * 1024 * 1024) throw new Error("That photo is larger than 15 MB. Choose a smaller one.");
  const blob = await resizeTo(file, 1200);
  if (blob.size > 3 * 1024 * 1024) throw new Error("That photo is too large after resizing. Choose a smaller one.");
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${supplierId}/${Date.now()}-${crypto.randomUUID().slice(0, 6)}.${ext}`;
  const { error } = await requireSupabase().storage.from("supplier-products").upload(path, blob, { contentType: blob.type || file.type, cacheControl: "31536000" });
  if (error) throw new Error(/bucket not found/i.test(error.message) ? "Product photo storage is not set up yet. Run migration 0013 in Supabase." : storageMessage(error.message));
  return path;
}
export const productImageUrl = (path: string) => requireSupabase().storage.from("supplier-products").getPublicUrl(path).data.publicUrl;
export async function removeProductImage(path: string) { try { await requireSupabase().storage.from("supplier-products").remove([path]); } catch { /* best effort */ } }
