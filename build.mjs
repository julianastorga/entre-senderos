import { build } from "esbuild";
import { readFile, readdir, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const target = (...parts) => path.join(root, ...parts);
const environment = process.env.APP_ENVIRONMENT || "demo";
if (!["demo", "production"].includes(environment)) throw new Error("APP_ENVIRONMENT must be demo or production.");
const config = JSON.parse(await readFile(target("staticwebapp.config.json"), "utf8"));
if (environment === "production") {
  const tenantId = process.env.PRODUCTION_ENTRA_TENANT_ID || "";
  config.routes.push({ route: "/.auth/login/github", statusCode: 404 });
  if (tenantId) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(tenantId)) throw new Error("PRODUCTION_ENTRA_TENANT_ID must be a tenant UUID.");
    config.auth = { identityProviders: { azureActiveDirectory: {
      userDetailsClaim: "preferred_username",
      registration: {
        openIdIssuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        clientIdSettingName: "PRODUCTION_ENTRA_CLIENT_ID",
        clientSecretSettingName: "PRODUCTION_ENTRA_CLIENT_SECRET",
      },
    } } };
  } else {
    config.routes.push({ route: "/.auth/login/aad", statusCode: 404 });
  }
}
const readerSource = await readFile(target("texto.html"), "utf8");
const sampleHtml = readerSource.match(/<div class="story-body" data-story-body>([\s\S]*?)<\/div>/u)?.[1].trim();
if (!sampleHtml) throw new Error("Missing the original sample story in texto.html.");
const sample = {
  version: 1, id: "ejemplo", title: "El consejo de las siete colas",
  author: "Texto de demostración · Autoría de muestra", tags: ["Relato breve"],
  html: sampleHtml, publishedAt: null, permissionConfirmed: true, sample: true,
};
await writeFile(target("sample-posts.mjs"), `import { COAUTHORED_SAMPLE } from "./editorial-model.mjs";\n\nexport const DEFAULT_POSTS = [\n  ${JSON.stringify(sample)},\n  { version: 1, ...COAUTHORED_SAMPLE, permissionConfirmed: true, sample: true },\n];\n`);
await build({
  entryPoints: [target("phone-input.mjs")], bundle: true, platform: "browser", format: "esm",
  target: "es2022", minify: true, legalComments: "linked", outfile: target("assets", "phone-input.js"),
});
await build({
  entryPoints: [target("word-import.worker.mjs")], bundle: true, platform: "browser", format: "esm",
  target: "es2022", minify: true, legalComments: "linked", outfile: target("assets", "word-import.worker.js"),
});
await build({
  entryPoints: [target("server", "function.mjs")], bundle: true, platform: "node", format: "cjs",
  target: "node22", legalComments: "linked", outfile: target("api", "http", "index.cjs"),
});
const lock = JSON.parse(await readFile(target("package-lock.json"), "utf8"));
const notices = [];
for (const [location, metadata] of Object.entries(lock.packages)) {
  if (!location || metadata.dev) continue;
  const directory = target(...location.split("/"));
  const files = (await readdir(directory)).filter((name) => /^(?:licen[cs]e|copying)(?:[._-].*)?$/iu.test(name));
  const packageInfo = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
  if (!files.length && !packageInfo.license) throw new Error(`Missing dependency license: ${location}`);
  const text = files.length
    ? (await Promise.all(files.map((file) => readFile(path.join(directory, file), "utf8")))).join("\n")
    : `License declared in package.json: ${packageInfo.license}\nAuthor: ${JSON.stringify(packageInfo.author || "")}\nUpstream: ${JSON.stringify(packageInfo.repository || "")}`;
  notices.push(`${location} ${metadata.version}\n${text}`);
}
await writeFile(target("assets", "THIRD-PARTY-NOTICES.txt"), notices.join("\n\n----------------------------------------\n\n"));
await rm(target("dist"), { recursive: true, force: true });
await mkdir(target("dist", "assets"), { recursive: true });
const frontend = [
  "styles.css", "site.js", "workshops.mjs", "calendar.mjs", "admin.mjs", "featured-text.mjs",
  "featured-admin.mjs", "text-import.mjs", "content-store.mjs", "email-validation.mjs", "image-model.mjs", "image-upload.mjs", "inline-image-editor.mjs",
  "catalog-model.mjs", "offering-admin.mjs", "contact-model.mjs", "contact-settings.mjs",
  "admin-settings.mjs", "newsletter-actions.mjs",
  "editorial-model.mjs", "reaction-model.mjs", "reactions.mjs", "sample-posts.mjs",
  "loading.mjs", "enrollment-admin.mjs", "enrollment-model.mjs", "enrollment-view.mjs",
  "page-copy-model.mjs", "page-copy.mjs", "page-copy-admin.mjs",
  "index.html", "cursos.html", "servicios.html", "propuesta.html", "calendario.html",
  "muestra.html", "texto.html", "acerca-de.html", "contacto.html", "newsletter.html", "admin.html",
];
for (const file of frontend) await copyFile(target(file), target("dist", file));
await writeFile(target("dist", "app-config.mjs"), "export const CLOUD_MODE = true;\n");
await writeFile(target("dist", "staticwebapp.config.json"), JSON.stringify(config, null, 2));
const assets = [
  "blog-cover.svg", "workshop-cover.svg", "phone-input.js",
  "word-import.worker.js", "word-import.worker.js.LEGAL.txt", "THIRD-PARTY-NOTICES.txt",
];
if ((await readdir(target("assets"))).includes("phone-input.js.LEGAL.txt")) assets.push("phone-input.js.LEGAL.txt");
for (const file of assets) await copyFile(target("assets", file), target("dist", "assets", file));
console.log("Built the Azure site, managed API and local Word converter.");
