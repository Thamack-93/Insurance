import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, getTestDb } from "../helpers/db";

function isHydrationError(message: string) {
  return /hydration failed|hydration mismatch|minified react error #418|text content does not match/i.test(message);
}

test.describe("authenticated rendering health", () => {
  test("does not emit React hydration errors on primary routes", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && isHydrationError(message.text())) errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => {
      if (isHydrationError(error.message)) errors.push(`pageerror: ${error.message}`);
    });

    await authenticatePageAsAdmin(page);
    const policy = await getTestDb().policy.findFirst({
      where: { policyNumber: "CI-POL-0001" },
      select: { id: true },
    });
    expect(policy).not.toBeNull();

    for (const path of ["/today", "/assistant", "/operations", `/policies/${policy!.id}`]) {
      errors.length = 0;
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(errors, `Hydration errors on ${path}`).toEqual([]);
    }
  });
});
