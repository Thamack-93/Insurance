import { execFileSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

if (process.env.VERCEL_ENV === "production") {
  execFileSync(npxCommand, ["prisma", "migrate", "deploy"], {
    env: process.env,
    stdio: "inherit",
  });
}

execFileSync(npmCommand, ["run", "build"], {
  env: process.env,
  stdio: "inherit",
});
