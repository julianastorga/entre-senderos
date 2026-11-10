export const MAX_IMAGE_BYTES = 256_000;
export const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_STORY_IMAGES = 12;
export const MAX_STORY_HTML_SIZE = 4_500_000;
export const IMAGE_PATH = /^\/api\/images\/[a-f0-9]{64}\.(?:jpg|png|webp)$/u;

export function validateImageFile(file) {
  if (!file) throw new Error("Elige una imagen JPG, PNG o WebP.");
  if (!Number.isSafeInteger(file.size) || file.size <= 0) throw new Error("El archivo está vacío. Elige otra imagen JPG, PNG o WebP.");
  if (file.size > MAX_IMAGE_FILE_BYTES) throw new Error("La imagen supera el límite de 8 MB por archivo. Elige una imagen más pequeña.");
}

export function imageMime(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export function isImageSource(src, { allowDataImages = false } = {}) {
  if (typeof src !== "string") return false;
  if (IMAGE_PATH.test(src)) return true;
  if (!allowDataImages || src.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 30) return false;
  return /^data:image\/(?:jpeg|png|webp);base64,(?:[a-zA-Z0-9+/]{4})*(?:[a-zA-Z0-9+/]{2}==|[a-zA-Z0-9+/]{3}=)?$/u.test(src);
}

export function validateImage(input, options) {
  if (!input || !isImageSource(input.src, options)) throw new Error("Usa una imagen cargada desde los controles de este editor.");
  const alt = typeof input.alt === "string" ? input.alt.trim() : "";
  if (!alt || alt.length > 250) throw new Error("Describe la imagen con entre 1 y 250 caracteres.");
  return { src: input.src, alt };
}

export function imageElement(image, className) {
  const element = document.createElement("img");
  element.src = image.src;
  element.alt = image.alt;
  element.className = className;
  element.loading = "lazy";
  element.decoding = "async";
  return element;
}
