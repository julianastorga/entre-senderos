import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFile, rm } from "node:fs/promises";
import path from "node:path";

if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "push" || process.env.GITHUB_REF !== "refs/heads/main") throw new Error("Azure provisioning is allowed only in GitHub Actions for a push to main.");
const group = "rg-entre-senderos-demo";
const site = "entre-senderos-demo-qfhwic53nsucu";
const az = (...args) => JSON.parse(execFileSync("az", [...args, "--output", "json", "--only-show-errors"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const current = az("staticwebapp", "appsettings", "list", "--name", site, "--resource-group", group).properties;
const secret = (key) => current[key] || randomBytes(32).toString("base64url");
const privateParameters = {
  demoPasswordHash: current.DEMO_ADMIN_PASSWORD_HASH || "",
  demoSessionSecret: current.DEMO_SESSION_SECRET || "",
  mailSettingsSecret: secret("MAIL_SETTINGS_SECRET"),
  mailDispatchKey: secret("MAIL_DISPATCH_KEY"),
};
for (const value of Object.values(privateParameters)) if (value) console.log(`::add-mask::${value}`);
if (current.DEMO_AUTH_ENABLED === "true" && (!privateParameters.demoPasswordHash || !privateParameters.demoSessionSecret)) throw new Error("Existing demo authentication could not be preserved.");
const parameters = {
  environment: "demo", adminGitHubLogins: current.ADMIN_GITHUB_LOGINS || "",
  demoAdminUsername: current.DEMO_ADMIN_USERNAME || "demo-admin",
  publicSiteOrigin: current.PUBLIC_SITE_ORIGIN || "",
  enableMailScheduler: process.env.ENABLE_MAIL_SCHEDULER === "true",
  ...privateParameters,
};
const file = path.join(process.env.RUNNER_TEMP, "entre-senderos-parameters.json");
await writeFile(file, JSON.stringify({ parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, { value }])) }), { mode: 0o600 });
try {
  execFileSync("az", ["deployment", "group", "create", "--resource-group", group, "--template-file", path.join("infra", "main.bicep"), "--parameters", `@${file}`, "--output", "none", "--only-show-errors"], { stdio: "inherit" });
} finally { await rm(file, { force: true }); }
