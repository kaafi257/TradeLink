/** Shrinks a phone photo to a small JPEG data URL (default: up to 1000 px, about 150 KB). */
export async function imageToDataUrl(file: File, maxDim = 1000, quality = 0.72): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose a photo.");
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process photos.");
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.toDataURL("image/jpeg", quality);
}
