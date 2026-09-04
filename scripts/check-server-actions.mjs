import fs from "node:fs";
import path from "node:path";

const sourceRoot = path.resolve("src");
const allowlisted = new Set([
  "src/app/login/actions.ts",
  "src/app/organization/select/actions.ts",
]);

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

const issues = [];
for (const file of walk(sourceRoot)) {
  const relative = path.relative(process.cwd(), file);
  const source = fs.readFileSync(file, "utf8");
  if (!/^"use server"\s*;?/m.test(source) || allowlisted.has(relative)) continue;
  if (!/\b(?:requireUser|requireAdmin|requireSuperAdmin|requireOrganization(?:Context|Role|PortfolioReadScope|Id)?|assertOrganizationContext(?:InTransaction)?|withOrganizationTransaction)\b/.test(source)) {
    issues.push(`${relative}: no internal authentication/authorization guard`);
  }
}

if (issues.length) {
  console.error(`Server Action security inventory: FAIL (${issues.length} issue(s))`);
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}
console.log("Server Action security inventory: PASS.");
