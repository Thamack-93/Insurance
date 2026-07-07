import { describe, expect, it } from "vitest";
import { buildPolicyDeleteBlockedMessage } from "@/lib/policy-delete";

describe("policy-delete", () => {
  it("allows deleting a policy when there are no paid receipts", () => {
    expect(buildPolicyDeleteBlockedMessage(0)).toBeNull();
    expect(buildPolicyDeleteBlockedMessage(-1)).toBeNull();
  });

  it("blocks deletion only for paid receipts and explains how to despagar them", () => {
    expect(buildPolicyDeleteBlockedMessage(1)).toContain("1 recibo pagado");
    expect(buildPolicyDeleteBlockedMessage(1)).toContain("despagarlo");

    const message = buildPolicyDeleteBlockedMessage(3);
    expect(message).toContain("3 recibos pagados");
    expect(message).toContain("despagarlos");
  });
});
