// Compress to JPEG targeting <500KB — not WebP: Safari/iOS can't encode it
// and silently falls back to PNG.
export async function compressPhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not process photo"))),
      "image/jpeg",
      0.8
    )
  );
}

/** Photos ride to the API as multipart; the API derives the storage path. */
export function photoForm(blob: Blob): FormData {
  const form = new FormData();
  form.append("file", blob, "photo.jpg");
  return form;
}

// Shared gate for the avatar picker and the log form. The API enforces JPEG
// and 5 MiB after compression; this catches the obvious mistakes before any
// decoding work and gives the user a reason instead of a decoder error.
export const PHOTO_MAX_RAW_BYTES = 20 * 1024 * 1024;

export function photoProblem(file: File): string | null {
  if (!file.type.startsWith("image/")) return "Choose an image file.";
  if (file.size > PHOTO_MAX_RAW_BYTES) return "That image is over 20 MB.";
  return null;
}
