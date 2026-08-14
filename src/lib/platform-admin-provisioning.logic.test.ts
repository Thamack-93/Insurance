import { describe, expect, it } from "vitest";
import { normalizePlatformAdminEmail, planPlatformAdminProvisioning, validatePlatformAdminPassword } from "@/lib/platform-admin-provisioning.logic";

describe("platform admin provisioning", () => {
  it("normalizes the fixed default account", () => {
    expect(normalizePlatformAdminEmail(undefined)).toBe("admin@policydesk.local");
    expect(normalizePlatformAdminEmail(" ADMIN@POLICYDESK.LOCAL ")).toBe("admin@policydesk.local");
  });

  it("requires a strong operator-provided password only for creation", () => {
    expect(() => validatePlatformAdminPassword("short")).toThrow("POLICYDESK_PLATFORM_ADMIN_PASSWORD_INVALID");
    expect(validatePlatformAdminPassword("a-secure-preview-password")).toBe("a-secure-preview-password");
    expect(planPlatformAdminProvisioning({ exists: false, active: false, platformRole: "NONE", membershipRoles: [], operationalAssignments: 0 })).toEqual({ action: "CREATE", requiresPassword: true });
  });

  it("promotes safely and rejects tenant ownership or assignments", () => {
    expect(planPlatformAdminProvisioning({ exists: true, active: true, platformRole: "NONE", membershipRoles: ["ADMIN"], operationalAssignments: 0 }).action).toBe("PROMOTE");
    expect(() => planPlatformAdminProvisioning({ exists: true, active: true, platformRole: "NONE", membershipRoles: ["OWNER"], operationalAssignments: 0 })).toThrow("POLICYDESK_SUPERADMIN_OWNER_CONFLICT");
    expect(() => planPlatformAdminProvisioning({ exists: true, active: true, platformRole: "NONE", membershipRoles: [], operationalAssignments: 1 })).toThrow("POLICYDESK_PLATFORM_ADMIN_OPERATIONAL_ASSIGNMENTS");
  });
});
