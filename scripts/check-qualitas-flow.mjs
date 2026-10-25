import "dotenv/config";
import { parse } from "parse5";

const MAX_LIVE_BYTES = 512 * 1024;
const LIVE_TIMEOUT_MS = 10_000;
const QUALITAS_PAYMENT_LINK_ENTRYPOINT = "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/inicio";

async function readBoundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_LIVE_BYTES) {
        await reader.cancel();
        throw new Error("La respuesta live excede el límite de tamaño.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function hasPolicyLookupComponent(html) {
  const document = parse(html);
  let hasPolicyInput = false;
  let hasSearchButton = false;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.tagName === "input") {
      const attrs = node.attrs ?? [];
      hasPolicyInput ||= attrs.some((attr) => (
        ["name", "id"].includes(attr.name.toLowerCase()) && attr.value === "numPoliza"
      ));
    }
    if (node.tagName === "button") {
      hasSearchButton ||= node.attrs?.some((attr) => attr.name.toLowerCase() === "id" && attr.value === "consultaPol") ?? false;
    }
    for (const child of node.childNodes ?? []) visit(child);
  }
  visit(document);
  return hasPolicyInput && hasSearchButton;
}

async function runOptionalLiveEntrypointCheck() {
  if (process.env.QUALITAS_FLOW_LIVE?.trim() !== "1") return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const response = await fetch(QUALITAS_PAYMENT_LINK_ENTRYPOINT, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "text/html" } });
    const url = new URL(response.url || QUALITAS_PAYMENT_LINK_ENTRYPOINT);
    if (url.protocol !== "https:" || url.hostname !== "www.qualitas.com.mx") throw new Error("El entrypoint live redirigió fuera del host permitido.");
    if (response.status < 200 || response.status >= 400) throw new Error(`El entrypoint live respondió HTTP ${response.status}.`);
    const html = await readBoundedText(response);
    if (!hasPolicyLookupComponent(html)) {
      throw new Error("El entrypoint live ya no expone el control de póliza y el botón de consulta esperados.");
    }
    return true;
  } finally {
    clearTimeout(timer);
  }
}

try {
  const live = await runOptionalLiveEntrypointCheck();
  console.log(`Quálitas flow check: PASS (fixtures estáticos en Vitest; ${live ? "entrypoint live GET" : "live desactivado"})`);
} catch (error) {
  console.error(`Quálitas flow check: FAIL — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
