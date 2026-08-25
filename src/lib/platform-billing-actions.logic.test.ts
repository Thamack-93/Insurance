import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireSuperAdmin = vi.hoisted(() => vi.fn());
const platformBillingMutationsEnabled = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const revalidatePaths = vi.hoisted(() => vi.fn());

const TestAuthError = vi.hoisted(() => class TestAuthError extends Error {});

vi.mock("@/lib/auth", () => ({ requireSuperAdmin, AuthError: TestAuthError }));
vi.mock("@/lib/platform-billing", () => ({ platformBillingMutationsEnabled }));
vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/mutation-utils", () => ({ revalidatePaths }));

import {
  assignPlatformSubscriptionAction,
  createPlatformPlanAction,
  recordPlatformChargeAction,
  transitionPlatformChargeAction,
} from "@/app/(platform)/platform/billing-actions";

const planInput = {
  requestId: "plan-request-1",
  code: "PRO",
  name: "Profesional",
  monthlyAmountMinor: "10000",
  currency: "MXN",
};

describe("platform billing mutation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdmin.mockResolvedValue({ id: "platform-admin", platformRole: "SUPERADMIN" });
    platformBillingMutationsEnabled.mockReturnValue(false);
  });

  it.each([
    ["create plan", () => createPlatformPlanAction(planInput)],
    ["assign subscription", () => assignPlatformSubscriptionAction({ requestId: "subscription-request-1", organizationId: "org-1", planId: "plan-1", status: "ACTIVE", reason: "Alta autorizada" })],
    ["record charge", () => recordPlatformChargeAction({ requestId: "charge-request-1", organizationId: "org-1", periodStart: "2026-08-01", periodEnd: "2026-08-31", amountMinor: "10000", currency: "MXN", status: "PENDING", reason: "Cargo mensual autorizado" })],
    ["transition charge", () => transitionPlatformChargeAction({ requestId: "transition-request-1", chargeId: "charge-1", status: "VOID", reason: "Anulación autorizada" })],
  ])("blocks %s while mutations are disabled", async (_label, invoke) => {
    await expect(invoke()).resolves.toEqual({ ok: false, error: "POLICYDESK_BILLING_MUTATIONS_DISABLED" });
    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires platform authorization before evaluating the mutation flag", async () => {
    requireSuperAdmin.mockRejectedValue(new TestAuthError("Esta acción requiere permisos de plataforma."));
    platformBillingMutationsEnabled.mockReturnValue(true);

    await expect(createPlatformPlanAction(planInput)).resolves.toEqual({ ok: false, error: "Esta acción requiere permisos de plataforma." });
    expect(platformBillingMutationsEnabled).not.toHaveBeenCalled();
  });
});
