import { expect, test, type Locator } from "@playwright/test";
import { authenticatePageAsAdmin } from "../helpers/db";

type MotionSurface = {
  name: string;
  path: string;
  target: string;
  region: string;
};

const motionSurfaces: MotionSurface[] = [
  {
    name: "today-summary",
    path: "/today",
    target: '[data-motion-target="lift"]',
    region: '[aria-label="Resumen operativo"]',
  },
  {
    name: "insights-kpis",
    path: "/today?view=insights",
    target: '[data-motion-target="icon-shift"]',
    region: "main",
  },
  {
    name: "activity-review-cards",
    path: "/activity",
    target: '[data-motion-target="lift"]',
    region: "main",
  },
];

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "tablet", width: 1024, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

async function expectInsideVisibleRegion(
  target: Locator,
  region: Locator,
) {
  const targetBox = await target.boundingBox();
  const regionBox = await region.boundingBox();
  expect(targetBox, "animated target should have a visible bounding box").not.toBeNull();
  expect(regionBox, "animated target should have a visible ancestor region").not.toBeNull();
  if (!targetBox || !regionBox) return;

  expect(targetBox.x).toBeGreaterThanOrEqual(regionBox.x - 1);
  expect(targetBox.y).toBeGreaterThanOrEqual(regionBox.y - 1);
  expect(targetBox.x + targetBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width + 1);
  expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(regionBox.y + regionBox.height + 1);
}

test.describe("global animation integrity", () => {
  test("keeps animated targets and their borders inside visible regions", async ({ page }, testInfo) => {
    await authenticatePageAsAdmin(page);

    for (const surface of motionSurfaces) {
      for (const viewport of viewports) {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(surface.path);

        const targets = page.locator(surface.target);
        const targetCount = await targets.count();
        expect(targetCount, `${surface.name} should expose animated targets`).toBeGreaterThan(0);

        const region = page.locator(surface.region);
        await expect(region).toHaveCount(1);

        for (let index = 0; index < targetCount; index += 1) {
          const target = targets.nth(index);
          await expect(target).toBeVisible();
          await target.scrollIntoViewIfNeeded();
          await target.hover();
          await expectInsideVisibleRegion(target, region);

          if (index === 0) {
            await page.screenshot({
              path: testInfo.outputPath(`${surface.name}-${viewport.name}-hover.png`),
              fullPage: true,
            });
          }

          if (surface.target.includes("lift")) {
            await target.focus();
            await expectInsideVisibleRegion(target, region);
            if (index === 0) {
              await page.screenshot({
                path: testInfo.outputPath(`${surface.name}-${viewport.name}-focus.png`),
                fullPage: true,
              });
            }
          }
        }
      }
    }
  });

  test("keeps the shared button press state inside its quick-action region", async ({ page }, testInfo) => {
    await authenticatePageAsAdmin(page);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/today");

      const quickActions = page.getByRole("region", { name: "Acciones rápidas" });
      const button = quickActions.getByRole("button", { name: "Registrar pago" });
      await expect(button).toHaveCount(1);
      await button.scrollIntoViewIfNeeded();

      const buttonBox = await button.boundingBox();
      expect(buttonBox).not.toBeNull();
      if (!buttonBox) return;

      await page.mouse.move(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
      await page.mouse.down();
      await expectInsideVisibleRegion(button, quickActions);
      await page.screenshot({ path: testInfo.outputPath(`today-button-${viewport.name}-active.png`), fullPage: true });
      await page.mouse.up();
      await page.keyboard.press("Escape");
    }
  });

  test("disables transform motion when reduced motion is requested", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await authenticatePageAsAdmin(page);
    await page.goto("/today");

    const target = page.locator('[data-motion-target="lift"]');
    const targetCount = await target.count();
    expect(targetCount).toBeGreaterThan(0);
    const firstTarget = target.nth(0);
    await firstTarget.hover();
    await expect(firstTarget).toHaveCSS("transform", "none");
  });
});
