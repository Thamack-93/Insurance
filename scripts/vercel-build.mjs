import { execFileSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
  // The runtime-only audit imports the generated Prisma enums and must run
  // before Next.js is allowed to build. Vercel may restore dependencies from
  // cache without restoring this generated, gitignored directory.
  execFileSync(npmCommand, ["run", "db:generate"], {
    env: process.env,
    stdio: "inherit",
  });
  execFileSync(npmCommand, ["run", "check:deployment-db-safety", "--", "--runtime-only"], {
    env: process.env,
    stdio: "inherit",
  });
}

execFileSync(npmCommand, ["run", "build"], {
  env: process.env,
  stdio: "inherit",
});
