import { BlobStore } from "./blob-store.mjs";
import { createApi } from "./app.mjs";
import { createDemoAuth } from "./demo-auth.mjs";

let handler;
export async function http(context, req) {
  try {
    handler ||= createApi({
      store: new BlobStore(process.env.AZURE_STORAGE_CONNECTION_STRING),
      adminLogins: process.env.ADMIN_GITHUB_LOGINS || "",
      environment: process.env.APP_ENVIRONMENT || "demo",
      productionDomain: process.env.PRODUCTION_ALLOWED_DOMAIN || "",
      productionTenantId: process.env.PRODUCTION_ENTRA_TENANT_ID || "",
      demoAuth: createDemoAuth({
        environment: process.env.APP_ENVIRONMENT,
        enabled: process.env.DEMO_AUTH_ENABLED === "true",
        username: process.env.DEMO_ADMIN_USERNAME,
        passwordHash: process.env.DEMO_ADMIN_PASSWORD_HASH,
        sessionSecret: process.env.DEMO_SESSION_SECRET,
      }),
    });
    context.res = await handler(req);
  } catch (error) {
    context.log.error("Request failed", error.name, error.code || "internal_error");
    context.res = {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      body: { error: "No pudimos acceder al servicio de Azure. No se confirmó ningún cambio. Inténtalo de nuevo más tarde." },
    };
  }
}
