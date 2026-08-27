import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [
  "src/app/(dashboard)/receipts",
  "src/app/(dashboard)/payments",
  "src/components/receipts",
  "src/components/payments",
];
const forbidden = /platform-billing|platform\/billing|BillingCharge|PlatformBilling/i;
const failures = [];

function visit(directory) {
  for (const entry of readdirSync(directory)) {
    const file = join(directory, entry);
    if (statSync(file).isDirectory()) visit(file);
    else if (/\.(ts|tsx)$/.test(entry)) {
      const source = readFileSync(file, "utf8");
      if (forbidden.test(source)) failures.push(file);
    }
  }
}

for (const root of roots) visit(root);

if (failures.length) {
  console.error(`Receipt/Payment Platform Billing boundary violated:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Receipt/Payment Platform Billing boundary passed (${roots.length} roots).`);
}
