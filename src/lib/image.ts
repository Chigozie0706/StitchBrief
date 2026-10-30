import { ALLOWED_IMAGE_TYPES, LIMITS } from "./config";

/** Returns an error message, or null if the file is acceptable. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) return "Please choose a JPEG, PNG or WebP image.";
  if (file.size > LIMITS.MAX_UPLOAD_BYTES) return "That image is over 10 MB. Please choose a smaller file.";
  return null;
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image.")); };
    img.src = url;
  });
}

function render(img: HTMLImageElement, maxEdge: number, quality: number): string {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process this image.");
  ctx.fillStyle = "#fff"; // flatten transparency
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

/** Downscales to keep requests small: `image` (1600px) is sent to the model, `thumb` (480px) is persisted. */
export async function prepareImage(file: File): Promise<{ image: string; thumb: string }> {
  const img = await load(file);
  return { image: render(img, 1600, 0.85), thumb: render(img, 480, 0.7) };
}
