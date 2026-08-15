import fs from "node:fs";
import path from "node:path";

const generatedDirectory = path.join(process.cwd(), "src", "generated", "prisma");
fs.writeFileSync(
  path.join(generatedDirectory, "package.json"),
  `${JSON.stringify({ type: "module" }, null, 2)}\n`,
  "utf8",
);
