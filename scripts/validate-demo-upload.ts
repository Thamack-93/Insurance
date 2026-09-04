import "dotenv/config";

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { validateDemoUpload } from "../src/lib/demo-upload-validation.ts";

function usage(): never {
  console.error("Uso: npm run validate:demo-upload -- /ruta/al/archivo.pdf");
  process.exit(2);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath || filePath.startsWith("-")) usage();

  const absolutePath = resolve(filePath);
  const bytes = await readFile(absolutePath);
  const result = await validateDemoUpload(new File([bytes], basename(absolutePath), { type: "application/pdf" }));

  // Operator output is intentionally limited to non-sensitive metadata. Never
  // print document content, filenames beyond the basename, or credentials.
  if (!result.ok) {
    console.error(JSON.stringify({ ok: false, code: result.code, message: result.message }));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    ok: true,
    sizeBytes: result.sizeBytes,
    sha256: result.sha256,
    detectedMimeType: result.detectedMimeType,
  }));
}

void main().catch(() => {
  console.error(JSON.stringify({ ok: false, code: "DEMO_UPLOAD_READ_FAILED", message: "No se pudo leer el archivo." }));
  process.exitCode = 1;
});
