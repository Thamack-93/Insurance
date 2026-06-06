import { spawn } from "node:child_process";

const commands = [
  {
    label: "policy-capture",
    args: ["--import", "tsx", "scripts/capture-pdf-renewals.ts"],
  },
  {
    label: "historical-receipts",
    args: ["--import", "tsx", "scripts/apply-historical-receipts.ts"],
  },
];

function runCommand(label: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
      }
    });

    child.on("error", reject);
  });
}

async function main() {
  for (const command of commands) {
    console.log(`\n=== Running ${command.label} dry-run ===`);
    await runCommand(command.label, command.args);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
