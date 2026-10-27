import { describe, expect, it } from "vitest";
import { bonusApprovalBlockReason } from "./bonus-approval";

describe("bonus approval safeguards", () => {
  it("blocks an empty run before approval", () => {
    expect(bonusApprovalBlockReason("READY", [])).toBe("EMPTY");
  });

  it("blocks REVIEW items and non-READY projections", () => {
    expect(bonusApprovalBlockReason("READY", ["INCLUDED", "REVIEW"])).toBe("NOT_READY");
    expect(bonusApprovalBlockReason("REVIEW", ["INCLUDED"])).toBe("NOT_READY");
  });

  it("keeps approved runs immutable", () => {
    expect(bonusApprovalBlockReason("APPROVED", ["INCLUDED"])).toBe("APPROVED");
  });

  it("allows a READY run with payment items regardless of the bonus amount", () => {
    expect(bonusApprovalBlockReason("READY", ["INCLUDED"])).toBeNull();
  });
});
