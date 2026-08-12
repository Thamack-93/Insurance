import { execFileSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

execFileSync(npmCommand, ["run", "build"], {
  env: process.env,
  stdio: "inherit",
});
