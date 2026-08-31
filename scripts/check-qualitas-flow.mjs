import "dotenv/config";

const MAX_LIVE_BYTES = 512 * 1024;
const LIVE_TIMEOUT_MS = 10_000;
const QUALITAS_PAYMENT_LINK_ENTRYPOINT = "https://www.qualitas.com.mx/portal/pagoLinea";

async function runOptionalLiveEntrypointCheck() {
  if (process.env.QUALITAS_FLOW_LIVE?.trim() !== "1") return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIVE_TIMEOUT_MS);
  try {
    const response = await fetch(QUALITAS_PAYMENT_LINK_ENTRYPOINT, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "text/html" } });
    const url = new URL(response.url || QUALITAS_PAYMENT_LINK_ENTRYPOINT);
    if (url.protocol !== "https:" || url.hostname !== "www.qualitas.com.mx") throw new Error("El entrypoint live redirigió fuera del host permitido.");
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_LIVE_BYTES) throw new Error("La respuesta live excede el límite de tamaño.");
    await response.body?.cancel();
    if (response.status < 200 || response.status >= 400) throw new Error(`El entrypoint live respondió HTTP ${response.status}.`);
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
