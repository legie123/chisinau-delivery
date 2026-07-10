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

export async function uploadMenuPhoto(restaurantId: string, file: File): Promise<string> {
  const compressed = await compressImage(file);
  const path = `${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

  const supabase = createClient();
  const { error } = await supabase.storage.from("restaurant-photos").upload(path, compressed, {
    contentType: "image/jpeg",
    cacheControl: "31536000",
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("restaurant-photos").getPublicUrl(path);
  return data.publicUrl;
}
