import mammoth from "mammoth";
import { parseMsDoc, renderMsDoc } from "@file-viewer/doc";

self.addEventListener("message", async ({ data: { buffer, extension } }) => {
  try {
    const bytes = new Uint8Array(buffer);
    let html;
    let warnings;
    if (extension === "docx") {
      if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("El archivo no es un DOCX válido o está protegido con contraseña.");
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
        styleMap: ["u => u", "p[style-name='Quote'] => blockquote:fresh", "p[style-name='Cita'] => blockquote:fresh"],
        includeEmbeddedStyleMap: false,
        externalFileAccess: false,
        convertImage: () => Promise.resolve([]),
      });
      html = result.value;
      warnings = result.messages.map((message) => message.message);
    } else if (extension === "doc") {
      const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
      if (!signature.every((value, index) => bytes[index] === value)) throw new Error("El archivo no es un DOC binario de Word 97–2003 válido.");
      const parsed = parseMsDoc(buffer, { maxPictureBytes: 0 });
      if (parsed.meta.fib.fEncrypted) throw new Error("No se admiten documentos protegidos con contraseña.");
      const result = renderMsDoc(parsed, { reviewMode: "final", externalLinkPolicy: "block", externalResourcePolicy: "block" });
      html = result.html;
      warnings = result.warnings.map((warning) => warning.message);
    } else {
      throw new Error("El formato Word solicitado no es válido.");
    }
    if (html.length > 10_000_000) throw new Error("El contenido convertido es demasiado grande. Prueba con un documento más pequeño.");
    self.postMessage({ html, warnings: [...new Set(warnings)] });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
});
