import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const patterns = [
  /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/,
  /(?:AKIA|ASIA)[0-9A-Z]{16}/,
  /gh[pousr]_[A-Za-z0-9_]{30,}/,
  /(?:DATABASE_URL|BLOB_READ_WRITE_TOKEN|CRON_SECRET|SESSION_SECRET)\s*[=:]\s*["']?(?:postgres(?:ql)?|https?:\/\/|[A-Za-z0-9_-]{24,})/i,
];
const ignored = /(?:^|\/)(?:\.env(?:\..*)?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;
const findings = [];
for (const file of tracked) {
  if (ignored.test(file)) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const pattern of patterns) {
    if (pattern.source.includes("DATABASE_URL|BLOB_READ_WRITE_TOKEN") && (file.startsWith(".github/workflows/") || file.endsWith(".test.ts"))) continue;
    if (pattern.test(text)) findings.push(`${file}: ${pattern}`);
  }
}
if (findings.length) {
  console.error("Secret scan failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}
console.log(`Secret scan PASS (${tracked.length} tracked files inspected).`);
