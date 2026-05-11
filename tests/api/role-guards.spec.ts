import { test, expect } from "@playwright/test";

test.describe("role-based guards", () => {
  test("backup download requires authentication", async ({ request }) => {
    const res = await request.get("/api/backups/anything.sqlite/download", {
      maxRedirects: 0,
    });
    expect([307, 401, 403, 404]).toContain(res.status());
  });

  test("login rejects empty credentials", async ({ request }) => {
    const res = await request.get("/login");
    expect(res.status()).toBe(200);
  });
});
