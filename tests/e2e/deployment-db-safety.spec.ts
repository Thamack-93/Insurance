import { expect, test } from "@playwright/test";
import { replaceTestDeploymentFingerprint } from "../helpers/db";

test("shows an operational error and unhealthy status for a deployment/database mismatch", async ({ page, request }) => {
  const expectedFingerprint = process.env.EXPECTED_DATABASE_FINGERPRINT;
  if (!expectedFingerprint) throw new Error("EXPECTED_DATABASE_FINGERPRINT is required for deployment safety E2E.");
  const mismatchFingerprint = expectedFingerprint === "f".repeat(64) ? "e".repeat(64) : "f".repeat(64);

  try {
    await replaceTestDeploymentFingerprint(mismatchFingerprint);
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Configuración de base de datos no disponible" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Iniciar sesión" })).toHaveCount(0);

    const health = await request.get("/api/health");
    expect(health.status()).toBe(503);
    await expect(health.json()).resolves.toMatchObject({ ok: false, databaseSafety: "unavailable" });
  } finally {
    await replaceTestDeploymentFingerprint(expectedFingerprint).catch(() => undefined);
  }

  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
});
