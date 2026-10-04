import { createClient } from "@/lib/supabase/client";
import { storageErrorText } from "@chisinau/shared-api";

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;
const MIN_SHORT_SIDE = 640;
const MIN_ASPECT_RATIO = 1.2; // longer/shorter side — rejects near-square/portrait crops
const MAX_ASPECT_RATIO = 2.5; // rejects panorama/ultra-wide crops

// Photo consistency gate (menu items only): the customer grid scans on a
// uniform crop, so reject bitmaps below a usable resolution or far from the
// recommended 16:9 (~1.78) before they ever get compressed/uploaded.
function assertMenuPhotoDimensions(bitmap: ImageBitmap): void {
  const shortSide = Math.min(bitmap.width, bitmap.height);
  if (shortSide < MIN_SHORT_SIDE) {
    throw new Error(`Fotografie prea mică (minim ${MIN_SHORT_SIDE}px pe latura scurtă) — încarcă o imagine de rezoluție mai mare.`);
  }
  const ratio = Math.max(bitmap.width, bitmap.height) / shortSide;
  if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) {
    throw new Error("Cadrul e prea departe de proporția recomandată 16:9 — recadrează preparatul (fără margini excesive sau colaj).");
  }
}

// Resize/re-encode client-side before upload, matching the pattern already
// proven at La Fratii Bikes — keeps menu photos small without a server step.
async function compressImage(file: File, validate?: (bitmap: ImageBitmap) => void): Promise<Blob> {
  // HEIC, PDF or a corrupt file: the browser throws "The source image could not be decoded." (EN).
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error("Imaginea nu poate fi citită — încearcă o fotografie JPG sau PNG.");
  });
  validate?.(bitmap);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Nu s-a putut procesa imaginea.");
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Compresia imaginii a eșuat."))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

// Shared compress-then-upload path — bucket + folder-scoped path, returns the
// storage object path (not a URL; callers decide public vs signed access).
async function uploadCompressedPhoto(
  bucket: string,
  folder: string,
  file: File,
  validate?: (bitmap: ImageBitmap) => void,
): Promise<string> {
  const compressed = await compressImage(file, validate);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (error) throw new Error(storageErrorText(error));
  return path;
}

export async function uploadMenuPhoto(restaurantId: string, file: File): Promise<string> {
  const path = await uploadCompressedPhoto("restaurant-photos", restaurantId, file, assertMenuPhotoDimensions);
  const supabase = createClient();
  const { data } = supabase.storage.from("restaurant-photos").getPublicUrl(path);
  return data.publicUrl;
}

// Directive 12 — proof-of-delivery photo (cash orders, web pilot). The
// 'delivery-proof' bucket is PRIVATE (unlike restaurant-photos), so this
// returns the storage PATH, not a public URL — attach_delivery_proof stores
// that path, and viewers (admin/customer) resolve it via a signed URL minted
// server-side.
export async function uploadDeliveryProofPhoto(orderId: string, file: File): Promise<string> {
  return uploadCompressedPhoto("delivery-proof", orderId, file);
}
