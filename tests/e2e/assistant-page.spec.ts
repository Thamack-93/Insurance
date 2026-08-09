import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

test.describe("Nora assistant", () => {
  test.use({ navigationTimeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await authenticatePageAsAdmin(page);
    await page.goto("/assistant");
  });

  test("renders as a focused chat instead of an admin dashboard", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Nora" })).toBeVisible();
    await expect(page.getByPlaceholder(/pregunta por una póliza/i)).toBeVisible();
    await expect(page.getByText("Pistas rápidas")).toHaveCount(0);
    await expect(page.getByText("Backlog de IA")).toHaveCount(0);
  });

  test("accepts a PDF dropped over the chat composer", async ({ page }) => {
    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    const composer = input.locator("xpath=../..");
    await composer.evaluate((section) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["%PDF-1.7"], "arrastre.pdf", { type: "application/pdf" }));
      section.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });

    await expect(page.getByText("arrastre.pdf", { exact: false })).toBeVisible();
    await expect(page.getByText("Arrastra PDFs aquí o selecciónalos", { exact: true })).toHaveCount(0);
  });

  test("uses the full workspace without nested scroll gaps and reports AI usage", async ({ page }) => {
    await page.route("**/api/assistant", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          response: {
            reply: "Encontré una póliza para revisar. No modificaré datos.",
            source: "ai",
            sections: [],
            quickPrompts: [],
            reportId: null,
            reportThemeKey: null,
            reportThemeLabel: null,
            aiRunId: "run-e2e",
            aiTier: "minimax",
            aiModel: "minimax/minimax-m3",
            aiAttempts: 1,
            aiUsage: {
              inputTokens: 100,
              outputTokens: 40,
              totalTokens: 140,
              cachedInputTokens: 0,
              estimatedCostUsd: 0.001,
              billedCostUsd: null,
              costSource: "estimated",
            },
            aiTrace: [{
              attemptNumber: 1,
              tier: "minimax",
              status: "SUCCEEDED",
              requestedModel: "minimax/minimax-m3",
              finalModel: "minimax/minimax-m3",
              fallbackReason: null,
              code: null,
              durationMs: 1200,
              finishReason: "stop",
              statusCode: 200,
              usage: null,
              responsePreview: "Encontré una póliza para revisar.",
            }],
            actionProposal: null,
          },
        }),
      });
    });

    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    await input.fill("Revisa mi cartera sin modificar datos.");
    await input.press("Enter");
    await expect(page.getByText("Encontré una póliza para revisar.", { exact: false })).toBeVisible();

    const workspace = page.getByRole("main").locator("section").first();
    const box = await workspace.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 720;
    expect(box?.height ?? 0).toBeGreaterThan(viewportHeight - 150);
    const scrollState = await page.getByRole("log").evaluate((log) => {
      const content = log.firstElementChild;
      const contentStyle = content ? getComputedStyle(content) : null;
      const messages = [...log.querySelectorAll("article")].map((message) => message.getBoundingClientRect());
      return {
        outerOverflow: getComputedStyle(log).overflow,
        contentOverflow: contentStyle?.overflow ?? "",
        contentHeight: content?.getBoundingClientRect().height ?? 0,
        contentScrollHeight: content?.scrollHeight ?? 0,
        messageGaps: messages.slice(1).map((message, index) => message.top - messages[index].bottom),
      };
    });
    expect(scrollState.outerOverflow).toBe("hidden");
    expect(scrollState.contentOverflow).toMatch(/auto|scroll/);
    expect(scrollState.messageGaps.every((gap) => gap <= 28)).toBe(true);
    await expect(page.getByRole("textbox", { name: /pregunta por una póliza/i })).toBeVisible();

    await page.getByText("Traza de IA", { exact: true }).click();
    await expect(page.getByText("$0.001 · estimado", { exact: true })).toBeVisible();

    const longPrompt = "revisa ".repeat(300);
    await input.fill(longPrompt);
    await expect.poll(() => input.evaluate((element) => element.scrollLeft)).toBe(0);
    await expect.poll(() => input.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test("renders informational local results as conversational text without cards", async ({ page }) => {
    await page.route("**/api/assistant", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          response: {
            reply: "Encontré 2 renovaciones:\n\n- [Póliza POL-300](/policies/policy-300) — María García · Qualitas · Prima: $4,500.00 MXN · Vence el 30/07/2026 (en 2 días).\n- [Póliza POL-301](/policies/policy-301) — Carlos López · AXA · Prima: $2,100.00 MXN · Vence el 04/08/2026 (en 7 días).",
            source: "local",
            sections: [],
            quickPrompts: [],
            reportId: null,
            reportThemeKey: null,
            reportThemeLabel: null,
            aiRunId: null,
            aiTier: "deterministic",
            aiModel: null,
            aiAttempts: 0,
            aiUsage: null,
            aiTrace: [],
            actionProposal: null,
          },
        }),
      });
    });

    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    await input.fill("renovaciones 30");
    await input.press("Enter");

    await expect(page.getByText("Encontré 2 renovaciones", { exact: false })).toBeVisible();
    await expect(page.locator('a[href="/policies/policy-300"]')).toBeVisible();
    await expect(page.locator('a[href="/policies/policy-301"]')).toBeVisible();
    await expect(page.getByRole("button", { name: "Renovaciones 30 días" })).toHaveCount(0);
    await expect(page.getByText("Póliza foco", { exact: true })).toHaveCount(0);
    await expect(page.getByPlaceholder(/pregunta por una póliza/i)).toBeVisible();
  });

  test("blocks unrelated questions before using the AI", async ({ page }) => {
    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    await input.fill("Dame una receta de pasta");
    await input.press("Enter");

    await expect(page.getByText(/solo puedo ayudarte con información y flujos de PolicyDesk/i)).toBeVisible();
  });

  test("shows unlimited AI usage in the admin panel", async ({ page }) => {
    await page.goto("/settings/assistant");
    await expect(page.getByText("Rate limits IA")).toBeVisible();
    await expect(page.getByText("Sin límite", { exact: true })).toBeVisible();
  });

  test("turns a reported system failure into an admin incident", async ({ page }) => {
    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    await input.fill("La captura de PDF no funciona");
    await input.press("Enter");

    await expect(page.getByText("Señal registrada", { exact: true })).toBeVisible();
    await page.goto("/settings/assistant?tab=incidentes");
    await expect(page.getByText(/INCIDENT · \d+ señales/).first()).toBeVisible();
  });
});
