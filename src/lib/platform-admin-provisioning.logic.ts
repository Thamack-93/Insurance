export const DEFAULT_PLATFORM_ADMIN_EMAIL = "admin@policydesk.local";
export const DEFAULT_PLATFORM_ADMIN_ID = "platform_admin_demo_0001";

export type PlatformAdminSnapshot = {
  exists: boolean;
  active: boolean;
  platformRole: string;
  membershipRoles: string[];
  operationalAssignments: number;
};

export type PlatformAdminPlan = {
  action: "CREATE" | "PROMOTE" | "NOOP";
  requiresPassword: boolean;
};

export function normalizePlatformAdminEmail(value: string | undefined): string {
  const email = (value ?? DEFAULT_PLATFORM_ADMIN_EMAIL).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new Error("POLICYDESK_PLATFORM_ADMIN_EMAIL_INVALID");
  }
  return email;
}

export function validatePlatformAdminPassword(value: string | undefined): string {
  const password = value ?? "";
  if (password.length < 16 || password.length > 256) {
    throw new Error("POLICYDESK_PLATFORM_ADMIN_PASSWORD_INVALID");
  }
  return password;
}

export function planPlatformAdminProvisioning(snapshot: PlatformAdminSnapshot): PlatformAdminPlan {
  if (snapshot.membershipRoles.includes("OWNER")) throw new Error("POLICYDESK_SUPERADMIN_OWNER_CONFLICT");
  if (snapshot.operationalAssignments > 0) throw new Error("POLICYDESK_PLATFORM_ADMIN_OPERATIONAL_ASSIGNMENTS");
  if (!snapshot.exists) return { action: "CREATE", requiresPassword: true };
  if (!snapshot.active || snapshot.platformRole !== "SUPERADMIN" || snapshot.membershipRoles.length > 0) {
    return { action: "PROMOTE", requiresPassword: false };
  }
  return { action: "NOOP", requiresPassword: false };
}
