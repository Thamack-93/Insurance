import type { Page } from "@playwright/test";

/** Captures the actual Next Server Action result around a UI submission. */
export async function captureServerAction(page: Page, submit: () => Promise<void>) {
  const responsePromise = page.waitForResponse(
    (response) => Boolean(response.request().headers()["next-action"]),
    { timeout: 20_000 },
  );
  await submit();
  const response = await responsePromise;
  const body = await response.text().catch(() => "<response body unavailable>");
  return {
    status: response.status(),
    body: body.replace(/\s+/g, " ").slice(0, 1000),
  };
}
