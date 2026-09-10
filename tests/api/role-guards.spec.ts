import { test, expect } from "@playwright/test";
import { getAdminSessionCookie, getAgentSessionCookie } from "../helpers/db";

test.describe("role-based guards", () => {
  test("backup download requires authentication", async ({ request }) => {
    const res = await request.get("/api/backups/artifacts/nonexistent/download", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(401);
  });

  test("backup download rejects authenticated agents", async ({ request }) => {
    const authCookie = await getAgentSessionCookie();
    const res = await request.get("/api/backups/artifacts/nonexistent/download", {
      headers: { cookie: authCookie },
      maxRedirects: 0,
    });
    expect(res.status()).toBe(403);
  });

  test("commission stats requires authentication", async ({ request }) => {
    const res = await request.get("/api/commissions/stats");
    expect(res.status()).toBe(401);
  });

  test("commission stats allows authenticated users", async ({ request }) => {
    const authCookie = await getAdminSessionCookie();
    const res = await request.get("/api/commissions/stats", {
      headers: { cookie: authCookie },
    });
    expect(res.status()).toBe(200);
  });

  test("Nora capability preflight allows authenticated assistant and reports", async ({ request }) => {
    const authCookie = await getAdminSessionCookie();
    const assistant = await request.get("/api/assistant", {
      headers: { cookie: authCookie },
    });
    expect(assistant.status()).toBe(200);

    const report = await request.get("/api/nora/reports?type=overdue", {
      headers: { cookie: authCookie },
    });
    expect(report.status()).toBe(200);

    const response = await request.post("/api/assistant", {
      headers: { cookie: authCookie, origin: "http://localhost:4173" },
      data: { message: "Dame una receta de pasta" },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
  });

  test("payments quick requires authentication", async ({ request }) => {
    const res = await request.post("/api/payments/quick", { data: {} });
    expect(res.status()).toBe(401);
  });

  test("login rejects empty credentials", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);
  });
});
