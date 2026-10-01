import type { TenantDb } from "@/lib/organization-context";

export type OrganizationCapabilityKey =
  | "NORA"
  | "IMPORTS"
  | "EXPORTS"
  | "DOCUMENTS"
  | "EMAIL"
  | "TELEGRAM"
  | "WHATSAPP"
  | "QUALITAS";

export type ResolvedOrganizationCapability = {
  organizationId: string;
  capability: OrganizationCapabilityKey;
  enabled: boolean;
  limitValue: number | null;
  reason: "GLOBAL_UNCERTIFIED" | "ORG_SUSPENDED" | "PLAN_DISABLED" | "ORG_OVERRIDE" | "PLAN" | "DEMO_RESTRICTED";
};

/**
 * DEMO tenants keep the complete internal workflow, but provider-facing
 * integrations remain an invariant of the tenant kind. This is deliberately
 * enforced after reading the organization from the same transaction used by
 * the caller, so a permissive platform flag or capability row cannot reopen
 * an external side effect.
 */
const DEMO_RESTRICTED_CAPABILITIES = new Set<OrganizationCapabilityKey>([
  "NORA",
  "IMPORTS",
  "EMAIL",
  "TELEGRAM",
  "WHATSAPP",
  "QUALITAS",
]);

export function isDemoExternalCapability(capability: OrganizationCapabilityKey) {
  return DEMO_RESTRICTED_CAPABILITIES.has(capability);
}

type CapabilityOrganization = {
  id: string;
  kind: string;
  status: string;
  capabilities?: Array<{ enabled: boolean; limitValue: number | null; source?: string | null }>;
  billingSubscriptions?: Array<{ status?: string; endsAt?: Date | null; plan: { code: string; active: boolean } | null }>;
};

const capabilityKillSwitch: Record<OrganizationCapabilityKey, string> = {
  NORA: "PLATFORM_NORA_ENABLED",
  IMPORTS: "PLATFORM_IMPORTS_ENABLED",
  EXPORTS: "PLATFORM_EXPORTS_ENABLED",
  DOCUMENTS: "PLATFORM_UPLOADS_ENABLED",
  EMAIL: "PLATFORM_EMAIL_ENABLED",
  TELEGRAM: "PLATFORM_TELEGRAM_ENABLED",
  WHATSAPP: "PLATFORM_WHATSAPP_ENABLED",
  QUALITAS: "PLATFORM_QUALITAS_ENABLED",
};

function isGloballyCertified(capability: OrganizationCapabilityKey) {
  // Kill switches are intentionally dynamic so operators can stop an
  // integration without redeploying. Local tests/dev remain backwards
  // compatible when a switch is absent; production treats a missing value as
  // disabled and the verifier requires every switch to be explicit.
  const switchValue = process.env[capabilityKillSwitch[capability]]?.trim();
  if (switchValue === "0") return false;
  if ((process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") && switchValue !== "1") return false;
  if (capability === "QUALITAS") return process.env.QUALITAS_PRODUCTION_CERTIFIED === "1";
  return true;
}

const defaultPlanEntitlements: Record<OrganizationCapabilityKey, boolean> = {
  NORA: true,
  IMPORTS: true,
  EXPORTS: true,
  DOCUMENTS: true,
  EMAIL: true,
  TELEGRAM: true,
  WHATSAPP: true,
  QUALITAS: false,
};

const OPERATOR_CERTIFIED_OVERRIDE_SOURCE = "OPERATOR_CERTIFIED";

function unavailableSchemaFallback(organizationId: string, capability: OrganizationCapabilityKey): ResolvedOrganizationCapability {
  const globallyAvailable = isGloballyCertified(capability);
  const planAvailable = defaultPlanEntitlements[capability];
  return {
    organizationId,
    capability,
    // This branch is only reachable in non-production test/dev environments
    // where the additive tables are not present yet. A real database always
    // resolves global certification and plan state below.
    enabled: globallyAvailable && planAvailable,
    limitValue: capability === "NORA" ? 4 : null,
    reason: !globallyAvailable ? "GLOBAL_UNCERTIFIED" : planAvailable ? "PLAN" : "PLAN_DISABLED",
  };
}

/**
 * Resolve an entitlement in one place. Global provider certification remains
 * the default upper bound. A capability marked OPERATOR_CERTIFIED is an
 * explicit, audited exception for the single organization that an operator
 * has approved for a controlled pilot.
 */
export async function resolveOrganizationCapability(
  organizationId: string,
  capability: OrganizationCapabilityKey,
  client?: TenantDb,
): Promise<ResolvedOrganizationCapability> {
  if (!organizationId.trim()) throw new Error("ORGANIZATION_ID_REQUIRED");
  if (client) return resolveCapabilityWithClient(organizationId, capability, client);
  if (process.env.NODE_ENV === "test") {
    try {
      const { getDb } = await import("@/lib/db");
      return await resolveCapabilityWithClient(organizationId, capability, getDb() as TenantDb);
    } catch {
      return unavailableSchemaFallback(organizationId, capability);
    }
  }

  // Authenticated requests use the live membership-backed context. Webhooks
  // and platform jobs may not have a browser session, so they fall back to an
  // explicitly identified system tenant transaction rather than a global
  // protected-table query.
  try {
    const { requireOrganizationContext, withTenantTransaction } = await import("@/lib/organization-context");
    const context = await requireOrganizationContext();
    if (context.organizationId !== organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
    return withTenantTransaction(context, (tx) => resolveCapabilityWithClient(organizationId, capability, tx));
  } catch (error) {
    if (error instanceof Error && error.message === "ORGANIZATION_CONTEXT_MISMATCH") throw error;
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
      // Authentication failures must not become a global capability bypass.
      if (error instanceof Error && !/UNAUTHENTICATED|iniciar sesión|organización activa/i.test(error.message)) throw error;
    }
  }

  try {
    const { withSystemOrganizationTransaction } = await import("@/lib/organization-context");
    return await withSystemOrganizationTransaction(organizationId, "capability resolution", (tx) => resolveCapabilityWithClient(organizationId, capability, tx));
  } catch (error) {
    if (process.env.NODE_ENV !== "production" && process.env.VERCEL_ENV !== "production") {
      return unavailableSchemaFallback(organizationId, capability);
    }
    throw error;
  }
}

async function resolveCapabilityWithClient(
  organizationId: string,
  capability: OrganizationCapabilityKey,
  db: Pick<TenantDb, "organization">,
): Promise<ResolvedOrganizationCapability> {
  const organizationDelegate = db.organization;
  if (!organizationDelegate?.findUnique) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw new Error("ORGANIZATION_CAPABILITY_SCHEMA_UNAVAILABLE");
    return unavailableSchemaFallback(organizationId, capability);
  }
  let organization: CapabilityOrganization | null;
  try {
    organization = await organizationDelegate.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        kind: true,
        status: true,
        capabilities: { where: { key: capability }, select: { enabled: true, limitValue: true, source: true } },
        billingSubscriptions: {
          where: { status: { in: ["ACTIVE", "TRIAL"] } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, endsAt: true, plan: { select: { code: true, active: true } } },
        },
      },
    }) as CapabilityOrganization | null;
  } catch (error) {
    if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") throw error;
    return unavailableSchemaFallback(organizationId, capability);
  }
  if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
  if (organization.status !== "ACTIVE") {
    return { organizationId, capability, enabled: false, limitValue: null, reason: "ORG_SUSPENDED" };
  }
  if (organization.kind === "DEMO" && isDemoExternalCapability(capability)) {
    return { organizationId, capability, enabled: false, limitValue: null, reason: "DEMO_RESTRICTED" };
  }
  const plan = organization.billingSubscriptions?.[0]?.plan;
  const subscription = organization.billingSubscriptions?.[0];
  const subscriptionCurrent = !subscription || (!subscription.endsAt || subscription.endsAt > new Date());
  const planEnabled = subscriptionCurrent && Boolean(plan?.active ?? true) && defaultPlanEntitlements[capability];
  const override = organization.capabilities?.[0];
  const operatorCertifiedEnable = capability === "QUALITAS"
    && override?.enabled === true
    && override.source === OPERATOR_CERTIFIED_OVERRIDE_SOURCE;
  if (!isGloballyCertified(capability) && !operatorCertifiedEnable) {
    return { organizationId, capability, enabled: false, limitValue: null, reason: "GLOBAL_UNCERTIFIED" };
  }
  if (!planEnabled && !operatorCertifiedEnable) {
    return { organizationId, capability, enabled: false, limitValue: null, reason: "PLAN_DISABLED" };
  }
  if (override && !override.enabled) {
    return { organizationId, capability, enabled: false, limitValue: override.limitValue ?? null, reason: "ORG_OVERRIDE" };
  }
  return {
    organizationId,
    capability,
    enabled: true,
    limitValue: override?.limitValue ?? (capability === "NORA" && organization.kind === "DEMO" ? 4 : null),
    reason: override ? "ORG_OVERRIDE" : "PLAN",
  };
}

export function isDemoOrganization(kind: string): boolean {
  return kind === "DEMO";
}
