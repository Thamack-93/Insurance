import { execFileSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
  execFileSync(npmCommand, ["run", "check:deployment-db-safety", "--", "--runtime-only"], {
    env: process.env,
    stdio: "inherit",
  });
}

execFileSync(npmCommand, ["run", "build"], {
  env: process.env,
  stdio: "inherit",
});
