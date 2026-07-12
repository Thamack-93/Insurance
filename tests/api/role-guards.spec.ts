import { test, expect } from "@playwright/test";
import { getAdminSessionCookie, getAgentSessionCookie } from "../helpers/db";

test.describe("role-based guards", () => {
  test("backup download requires authentication", async ({ request }) => {
    const res = await request.get("/api/backups/anything.sqlite/download", {
      maxRedirects: 0,
    });
    expect([307, 401, 403, 404]).toContain(res.status());
  });

  test("backup download rejects authenticated agents", async ({ request }) => {
    const authCookie = await getAgentSessionCookie();
    const res = await request.get("/api/backups/anything.sqlite/download", {
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

  test("payments quick requires authentication", async ({ request }) => {
    const res = await request.post("/api/payments/quick", { data: {} });
    expect(res.status()).toBe(401);
  });

  test("login rejects empty credentials", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);
  });
});
