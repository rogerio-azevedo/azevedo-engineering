import { basename } from "node:path";

const EXACT = new Set([".npmrc", ".pypirc", ".netrc"]);

export function isSensitivePath(relativePath: string): boolean {
  const name = basename(relativePath.replaceAll("\\", "/"));
  if (EXACT.has(name)) return true;
  if (name === ".env" || name.startsWith(".env.")) return true;
  if (name.startsWith("id_rsa") || name.startsWith("id_ed25519")) return true;
  if (/^credentials.*\.json$/i.test(name) || /^service-account.*\.json$/i.test(name)) return true;
  if (name.startsWith("secrets.")) return true;
  return /\.(?:pem|key|p12|pfx|jks|keystore|tfvars)$/i.test(name);
}
