import { readFileSync } from "node:fs";

const checks = [
  {
    label: "Pólizas desde navegación general",
    file: "src/app/(dashboard)/policies/page.tsx",
    markers: ["LocalNavigation", "policyNavigation"],
  },
  {
    label: "Cartera desde Reportes",
    file: "src/app/(dashboard)/reports/page.tsx",
    markers: ["LocalNavigation", "reportsNavigation"],
  },
  {
    label: "Cartera con navegación local propia",
    file: "src/app/(dashboard)/portfolio/page.tsx",
    markers: ["LocalNavigation", "reportsNavigation"],
  },
  {
    label: "Insights desde Hoy",
    file: "src/lib/navigation.ts",
    markers: ["todayNavigation", '/today?view=insights'],
  },
  {
    label: "Insights con navegación local propia",
    file: "src/app/(dashboard)/today/page.tsx",
    markers: ["LocalNavigation", "todayNavigation"],
  },
];

const failures = [];
for (const check of checks) {
  const source = readFileSync(check.file, "utf8");
  const missing = check.markers.filter((marker) => !source.includes(marker));
  if (missing.length) failures.push(`${check.label}: faltan ${missing.join(", ")}`);
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Navigation reachability checks passed (${checks.length}).`);
}
