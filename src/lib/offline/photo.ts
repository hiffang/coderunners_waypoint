import { MAX_UPLOAD_BYTES } from "@/shared/dto/files";

const MAX_EDGE = 1600;

/**
 * Phone camera photos are often larger than the 5 MB upload limit and fill
 * offline storage quickly. Downscale to JPEG before storing. If the browser
 * cannot decode the image, keep the original when it is already small enough.
 */
export async function prepareEvidencePhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    if (blob && blob.size <= MAX_UPLOAD_BYTES) return blob;
  } catch {
    // fall through to the original
  }
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= MAX_UPLOAD_BYTES) return file;
  throw new Error("This photo cannot be used. Take it again or choose a JPEG/PNG under 5 MB.");
}
