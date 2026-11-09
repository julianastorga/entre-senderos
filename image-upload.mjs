import { CLOUD_MODE } from "./app-config.mjs";
import { apiRequest } from "./content-store.mjs";
import { MAX_IMAGE_BYTES, MAX_IMAGE_FILE_BYTES, imageMime, imageElement, validateImage } from "./image-model.mjs";

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(blob);
  });
}

export async function uploadImage(file) {
  if (!file || !file.size || file.size > MAX_IMAGE_FILE_BYTES) throw new Error("Elige una imagen JPG, PNG o WebP de hasta 8 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = imageMime(bytes);
  if (!mimeType) throw new Error("Solo se admiten imágenes JPG, PNG y WebP; SVG y otros formatos no están permitidos.");
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
  } catch {
    throw new Error("La imagen está dañada o no se puede abrir.");
  }

  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Este navegador no permite preparar imágenes.");
    let scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
      if (!blob) throw new Error("No se pudo preparar la imagen.");
      if (blob.size <= MAX_IMAGE_BYTES) {
        const source = await dataUrl(blob);
        if (!CLOUD_MODE) return source;
        const { value } = await apiRequest("images", {
          method: "POST", body: { mimeType: blob.type, data: source.slice(source.indexOf(",") + 1) },
        });
        return value.src;
      }
      scale *= 0.7;
    }
    throw new Error("La imagen sigue siendo demasiado grande. Elige otra imagen de menor tamaño.");
  } finally {
    bitmap.close();
  }
}

export function createCoverUpload(form, prefix, status, onChanged) {
  const input = document.querySelector(`#${prefix}-cover-upload`);
  const alt = document.querySelector(`#${prefix}-cover-alt`);
  const preview = document.querySelector(`#${prefix}-cover-preview`);
  const remove = document.querySelector(`#${prefix}-cover-remove`);
  const panel = form.closest('[role="tabpanel"]');
  let src = null;
  function set(image) {
    src = image?.src || null;
    alt.value = image?.alt || "";
    preview.replaceChildren();
    preview.hidden = !src;
    remove.hidden = !src;
    input.value = "";
    if (src) preview.append(imageElement({ src, alt: alt.value || "Vista previa de portada" }, "cover-preview-image"));
  }
  input.addEventListener("change", async () => {
    const file = input.files[0];
    if (!file) return;
    panel.inert = true;
    status.textContent = "Preparando la portada…";
    try {
      const source = await uploadImage(file);
      set({ src: source, alt: alt.value });
      onChanged();
      status.textContent = "Portada cargada. Describe la imagen y guarda para publicarla con el contenido.";
    } catch (error) {
      status.textContent = `No se cargó la portada. ${error.message}`;
    } finally {
      input.value = "";
      panel.inert = false;
    }
  });
  alt.addEventListener("input", () => {
    if (preview.firstElementChild) preview.firstElementChild.alt = alt.value || "Vista previa de portada";
  });
  remove.addEventListener("click", () => { set(null); onChanged(); });
  return { set, read: () => src ? validateImage({ src, alt: alt.value }, { allowDataImages: !CLOUD_MODE }) : null };
}
