import { Resolver } from "node:dns/promises";

export async function verifyMailDomain(domain, lookup) {
  const resolver = new Resolver({ timeout: 2000, tries: 2 });
  try {
    const records = await (lookup || ((name) => resolver.resolveMx(name)))(domain);
    if (!records.some(({ exchange }) => exchange && exchange !== ".")) {
      const error = new Error("Ese dominio no acepta correo. Revisa la dirección.");
      error.status = 400;
      throw error;
    }
  } catch (error) {
    if (error.status === 400) throw error;
    const invalid = ["ENODATA", "ENOTFOUND"].includes(error.code);
    const failure = new Error(invalid
      ? "No encontramos un servicio de correo para ese dominio. Revisa la dirección."
      : "No se pudo verificar el dominio del correo. Inténtalo más tarde.");
    failure.status = invalid ? 400 : 503;
    throw failure;
  } finally {
    resolver.cancel();
  }
}
