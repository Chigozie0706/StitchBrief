import { ALLOWED_IMAGE_TYPES, LIMITS } from "./config";
import { sha256Hex } from "./hash";

export const formatBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** Returns a user-facing error message, or null if the file can be used. */
export function validateImageFile(file: { type: string; size: number; name?: string }): string | null {
  const name = file.name ?? "";
  if (/heic|heif/i.test(file.type) || /\.hei[cf]$/i.test(name))
    return "HEIC photos aren’t supported. Export or share the photo as JPEG, then try again.";
  if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    const label = file.type.startsWith("image/") ? file.type.slice(6).toUpperCase() : /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toUpperCase() ?? "That file type";
    return `${label}${label === "That file type" ? " isn’t" : " files aren’t"} supported. Please choose a JPEG, PNG or WebP image.`;
  }
  if (file.size === 0) return "That file is empty. Please choose another image.";
  if (file.size > LIMITS.MAX_UPLOAD_BYTES) return `That image is ${formatBytes(file.size)}. The limit is ${LIMITS.MAX_UPLOAD_BYTES / 1_000_000} MB.`;
  return null;
}

/** Non-blocking: small images hide seams, trims and other fine detail. */
export function qualityAdvisory(width: number, height: number): string | null {
  if (Math.min(width, height) < 400 || Math.max(width, height) < 700)
    return `This image is small (${width}×${height}). Seams, trims and other fine details may not be visible. A larger photo gives better results.`;
  return null;
}

/** EXIF orientation (1–8) of a JPEG, 1 when absent. Phone photos are often rotated via this tag. */
export function jpegOrientation(b: Uint8Array): number {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 4 < b.length) {
    if (b[i] !== 0xff) return 1;
    const marker = b[i + 1];
    const len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xda) return 1; // start of scan: no EXIF after this
    if (marker === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o: number) => (le ? b[t + o] | (b[t + o + 1] << 8) : (b[t + o] << 8) | b[t + o + 1]);
      const u32 = (o: number) => (le ? (b[t + o] | (b[t + o + 1] << 8) | (b[t + o + 2] << 16) | (b[t + o + 3] << 24)) >>> 0 : ((b[t + o] << 24) | (b[t + o + 1] << 16) | (b[t + o + 2] << 8) | b[t + o + 3]) >>> 0);
      const ifd = u32(4);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (t + e + 12 > b.length) return 1;
        if (u16(e) === 0x0112) return u16(e + 8) || 1;
      }
      return 1;
    }
    i += 2 + len;
  }
  return 1;
}

/** Original bytes are sent untouched when they are small and upright; otherwise the image is resized. */
export const PASSTHROUGH_BYTES = 4_000_000;
export const PASSTHROUGH_MAX_EDGE = 4096;
const RESIZE_MAX_EDGE = 2560;

export type PreparedImage = {
  image: string; thumb: string; width: number; height: number; bytes: number;
  /** True when the image was resized or re-encoded (never for small, upright files). */
  resized: boolean; hash: string; advisory: string | null;
};

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image. Please choose another one.")); };
    img.src = url;
  });
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("That file could not be read. Please try again."));
    r.readAsDataURL(file);
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
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height); // browsers apply EXIF orientation here
  return canvas.toDataURL("image/jpeg", quality);
}

const decodedBytes = (dataUrl: string) => Math.floor(((dataUrl.length - dataUrl.indexOf(",") - 1) * 3) / 4);

export async function prepareImage(file: File): Promise<PreparedImage> {
  const img = await load(file);
  const width = img.naturalWidth, height = img.naturalHeight;
  const head = new Uint8Array(await file.slice(0, 131072).arrayBuffer());
  const rotated = file.type === "image/jpeg" && jpegOrientation(head) !== 1;
  const passthrough = file.size <= PASSTHROUGH_BYTES && Math.max(width, height) <= PASSTHROUGH_MAX_EDGE && !rotated;
  let image = passthrough ? await readDataUrl(file) : render(img, RESIZE_MAX_EDGE, 0.92);
  if (decodedBytes(image) > LIMITS.MAX_IMAGE_BYTES) image = render(img, 1600, 0.85);
  const outW = passthrough ? width : Math.round(width * Math.min(1, RESIZE_MAX_EDGE / Math.max(width, height)));
  const outH = passthrough ? height : Math.round(height * Math.min(1, RESIZE_MAX_EDGE / Math.max(width, height)));
  return {
    image, thumb: render(img, 480, 0.7), width: outW, height: outH, bytes: decodedBytes(image),
    resized: !passthrough, hash: await sha256Hex(image), advisory: qualityAdvisory(width, height),
  };
}
