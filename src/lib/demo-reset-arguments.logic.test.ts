import { describe, expect, it } from "vitest";

import { parseDemoResetArguments } from "../../scripts/demo-reset-arguments";

describe("parseDemoResetArguments", () => {
  it("rejects a flag used where the reason value is required", () => {
    const parsed = parseDemoResetArguments([
      "--organization-id",
      "org_demo_example",
      "--reason",
      "--request-id",
      "ticket-124",
    ]);

    expect(parsed).toMatchObject({
      organizationId: "org_demo_example",
      requestId: "ticket-124",
      reason: undefined,
      dryRun: false,
      help: false,
    });
  });

  it("parses a reason and the dry-run flag", () => {
    expect(
      parseDemoResetArguments([
        "--organization-id",
        "org_demo_example",
        "--request-id",
        "ticket-124",
        "--reason",
        "Approved synthetic reset",
        "--dry-run",
      ]),
    ).toEqual({
      organizationId: "org_demo_example",
      requestId: "ticket-124",
      reason: "Approved synthetic reset",
      dryRun: true,
      help: false,
    });
  });
});
