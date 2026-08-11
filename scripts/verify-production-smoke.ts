import { chromium } from "@playwright/test";

async function main() {
  const baseUrl = process.env.PRODUCTION_SMOKE_BASE_URL?.trim();
  const email = process.env.PRODUCTION_SMOKE_EMAIL?.trim();
  const password = process.env.PRODUCTION_SMOKE_PASSWORD;
  if (!baseUrl || !email || !password) throw new Error("Faltan las variables del smoke productivo.");
  const target = new URL(baseUrl);
  if (target.protocol !== "https:") throw new Error("El smoke productivo requiere HTTPS.");

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const pageErrors: string[] = [];
  const unexpectedResponses: number[] = [];
  page.on("pageerror", () => pageErrors.push("pageerror"));
  page.on("response", (response) => {
    if (response.url().startsWith(target.origin) && response.status() >= 500) unexpectedResponses.push(response.status());
  });
  try {
    const loginResponse = await page.goto(new URL("/login", target).toString(), { waitUntil: "networkidle" });
    if (!loginResponse?.ok()) throw new Error("La página de login no respondió correctamente.");
    await page.getByLabel(/correo/i).fill(email);
    await page.getByLabel(/contraseña/i).fill(password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/today", { timeout: 30_000 }),
      page.getByRole("button", { name: /iniciar sesión/i }).click(),
    ]);
    await page.goto(new URL("/clients", target).toString(), { waitUntil: "networkidle" });
    if (new URL(page.url()).pathname !== "/clients") throw new Error("Clients no terminó de cargar con sesión autenticada.");
    await Promise.all([
      page.waitForURL((url) => url.pathname === "/login", { timeout: 30_000 }),
      page.getByRole("button", { name: /cerrar sesión/i }).click(),
    ]);
    if (pageErrors.length > 0 || unexpectedResponses.length > 0) throw new Error("El smoke detectó errores de runtime.");
    console.log(JSON.stringify({ status: "PASS", loginPage: true, authenticatedLogin: true, todayPage: true, clientsPage: true, logout: true, pageErrors: 0, unexpected500Responses: 0 }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "Falló el smoke productivo." }));
  process.exitCode = 1;
});
