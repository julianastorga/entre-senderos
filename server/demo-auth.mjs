import { createHmac, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const deriveKey = promisify(scrypt);
const cookieName = "__Secure-entre_senderos_demo";

export function createDemoAuth({ environment, enabled, username, passwordHash, sessionSecret, now = Date.now }) {
  if (environment !== "demo" || !enabled) return null;
  if (!username || !/^[a-f0-9]{32}\.[a-f0-9]{128}$/u.test(passwordHash || "") || (sessionSecret || "").length < 32) {
    throw new Error("La autenticación de demostración no está configurada correctamente.");
  }
  const [salt, hash] = passwordHash.split(".");
  const sign = (payload) => createHmac("sha256", sessionSecret).update(payload).digest();
  const cookie = (value, maxAge) => `${cookieName}=${value}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
  return {
    async verify(login, password) {
      const actual = await deriveKey(password, salt, 64);
      return timingSafeEqual(actual, Buffer.from(hash, "hex")) && login === username;
    },
    issue() {
      const payload = Buffer.from(JSON.stringify({ username, expiresAt: now() + 2 * 60 * 60 * 1000 })).toString("base64url");
      return cookie(`${payload}.${sign(payload).toString("base64url")}`, 7200);
    },
    clear: () => cookie("", 0),
    session(header = "") {
      const token = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (!token || token.length > 1024) return null;
      const parts = token.split(".");
      if (parts.length !== 2) return null;
      const expected = sign(parts[0]);
      const signature = Buffer.from(parts[1], "base64url");
      if (signature.length !== expected.length || !timingSafeEqual(expected, signature)) return null;
      try {
        const value = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
        return value.username === username && Number.isFinite(value.expiresAt) && value.expiresAt > now() ? { login: username } : null;
      } catch {
        return null;
      }
    },
  };
}
