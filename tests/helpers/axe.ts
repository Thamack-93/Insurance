import { expect, type Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING_IMPACTS = new Set(["serious", "critical"]);

/**
 * Keeps accessibility coverage actionable while the UI is being modernized:
 * only WCAG A/AA violations with serious or critical impact block the suite.
 */
export async function expectNoSeriousAxeViolations(page: Page, scope?: string) {
  const builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (scope) builder.include(scope);

  const results = await builder.analyze();
  const blocking = results.violations.filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ""));

  expect(
    blocking,
    blocking
      .map(
        (violation) =>
          `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} — ${violation.nodes
            .map((node) => node.target.join(" "))
            .join(", ")}`,
      )
      .join("\n"),
  ).toEqual([]);
}
