import { createClient } from "@/lib/supabase/client";

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

// Resize/re-encode client-side before upload, matching the pattern already
// proven at La Fratii Bikes — keeps menu photos small without a server step.
async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
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
async function uploadCompressedPhoto(bucket: string, folder: string, file: File): Promise<string> {
  const compressed = await compressImage(file);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const supabase = createClient();
  const { error } = await supabase.storage.from(bucket).upload(path, compressed, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function uploadMenuPhoto(restaurantId: string, file: File): Promise<string> {
  const path = await uploadCompressedPhoto("restaurant-photos", restaurantId, file);
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
