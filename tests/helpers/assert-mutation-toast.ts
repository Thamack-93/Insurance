import { expect, type Page } from "@playwright/test";

/** Preserve the toast assertion while surfacing server-action/form rejection details in CI. */
export async function expectMutationSuccessToast(page: Page, expected: RegExp | string) {
  try {
    await expect(page.locator(".cn-toast").filter({ hasText: expected })).toBeVisible({ timeout: 10_000 });
  } catch (error) {
    const [alerts, toasts] = await Promise.all([
      page.getByRole("alert").allTextContents(),
      page.locator(".cn-toast").allTextContents(),
    ]);
    throw new Error(
      `Expected success toast ${String(expected)}. Form alerts: ${alerts.join(" | ") || "none"}. Toasts: ${toasts.join(" | ") || "none"}. Original assertion: ${String(error)}`,
    );
  }
}
