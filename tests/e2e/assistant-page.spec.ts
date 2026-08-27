import { expect, test } from "@playwright/test";
import { authenticatePageAsAdmin, getTestDb } from "../helpers/db";

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

  test("keeps independent capture cards after opening one and returning to Nora", async ({ page }) => {
    const db = getTestDb();
    const user = await db.user.findUnique({ where: { email: "ci-admin@policydesk.local" }, select: { id: true } });
    if (!user) throw new Error("Missing CI admin fixture.");
    const now = Date.now();
    const ids = ["handoff-e2e-1", "handoff-e2e-2"];
    const buildDraft = (policyNumber: string, fileName: string) => ({
      policyNumber,
      clientName: "CLIENTE E2E",
      clientType: "COMPANY",
      clientEmail: null,
      clientPhone: null,
      clientAddress: null,
      clientRfc: null,
      clientBirthDate: null,
      insurerName: "Seguros Banorte",
      policyType: "AUTO",
      serialNumber: null,
      startDate: "2026-08-01",
      endDate: "2027-08-01",
      issueDate: "2026-08-01",
      paymentFrequency: "ANNUAL",
      paymentPlan: null,
      premiumAmount: 1000,
      currency: "MXN",
      requestNumber: null,
      insuredObject: fileName,
      beneficiaryInfo: null,
      notes: null,
      sourcePolicyNumber: null,
    });
    const drafts = [buildDraft("POL-1", "uno.pdf"), buildDraft("POL-2", "dos.pdf")];
    await page.addInitScript(({ userId, now, ids, drafts }) => {
      const userKey = encodeURIComponent(userId);
      const provenance = { requestedMode: "local", extractionSource: "local", reviewSource: "none", aiRunIds: [], trackingStatus: "recorded", aiAttempted: false };
      const session = {
        version: 2,
        ownerId: userId,
        createdAt: now,
        updatedAt: now,
        expiresAt: now + 1_800_000,
        input: "",
        context: null,
        activeCaptureHandoffId: ids[0],
        messages: [
          { id: "welcome", role: "assistant", text: "Hola Nora" },
          { id: "capture-1", role: "assistant", text: "Captura 1 lista", capture: { handoffId: ids[0], fileName: "uno.pdf", fileKey: "uno.pdf:1:1" } },
          { id: "capture-2", role: "assistant", text: "Captura 2 lista", capture: { handoffId: ids[1], fileName: "dos.pdf", fileKey: "dos.pdf:1:1" } },
        ],
      };
      sessionStorage.setItem(`policydesk.nora.session.v2:${userKey}`, JSON.stringify(session));
      sessionStorage.setItem(`policydesk.policyCapture.index.v5:${userKey}`, JSON.stringify(ids));
      ids.forEach((handoffId, index) => {
        const payload = { handoffId, draft: drafts[index], warnings: [], aiReview: null, provenance };
        sessionStorage.setItem(`policydesk.policyCapture.v5:${userKey}:${encodeURIComponent(handoffId)}`, JSON.stringify({ version: 5, ownerId: userId, createdAt: now, expiresAt: now + 900_000, payload }));
      });
    }, { userId: user.id, now, ids, drafts });
    await page.reload();

    await expect(page.getByText("uno.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("dos.pdf", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Revisar captura" }).first().click();
    await expect(page).toHaveURL(/\/policies\/capture\?handoffId=handoff-e2e-1/);
    await page.goBack();
    await expect(page.getByText("uno.pdf", { exact: true })).toBeVisible();
    await expect(page.getByText("dos.pdf", { exact: true })).toBeVisible();
  });

  test("keeps inline PDF cards compact and side by side on a wide viewport", async ({ page }) => {
    const input = page.getByPlaceholder(/pregunta por una póliza/i);
    const composer = input.locator("xpath=../..");
    await composer.evaluate((section) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File(["%PDF-1.7"], "uno.pdf", { type: "application/pdf" }));
      dataTransfer.items.add(new File(["%PDF-1.7"], "dos.pdf", { type: "application/pdf" }));
      section.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
    });
    const files = page.locator('[data-policy-pdf-picker="true"] li');
    await expect(files).toHaveCount(2);
    const boxes = await files.evaluateAll((items) => items.map((item) => item.getBoundingClientRect()));
    expect(boxes[0]?.top).toBe(boxes[1]?.top);
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
    await expect(page.getByText(/Incidente.*\d+ señales/).first()).toBeVisible();
  });
});
