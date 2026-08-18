import { BOOTSTRAP_ORGANIZATION_ID } from "./tenant-organization-foundation";

export const PEDRO_ORGANIZATION_ID = BOOTSTRAP_ORGANIZATION_ID;
export const PEDRO_CONFIGURATION_LOCK_KEY = "policydesk-pedro-organization-configuration";

export type PedroOrganizationInputs = {
  name: string;
  slug: string;
  timeZone: string;
  currency: string;
  ownerEmail: string;
};

export type PedroOrganizationMetadata = Pick<PedroOrganizationInputs, "name" | "slug" | "timeZone" | "currency">;

export type PedroOrganizationSnapshot = {
  organizationStatus: string | null;
  organizationId: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  organizationTimeZone: string | null;
  organizationCurrency: string | null;
  nonTechnicalUsers: number;
  nonTechnicalUserIds: string[];
  ownerUserId: string | null;
  ownerCount: number;
  pedroUserId: string | null;
  pedroActive: boolean;
  pedroLegacyRole: string | null;
  pedroMembershipRole: string | null;
  pedroMembershipActive: boolean | null;
  tenantNullCount: number;
  tenantAuditOk: boolean;
};

export type PedroOrganizationMetadataChanges = Partial<Record<keyof PedroOrganizationMetadata, {
  from: string | null;
  to: string;
}>>;

export type PedroOrganizationCurrentMetadata = {
  name: string | null;
  slug: string | null;
  timeZone: string | null;
  currency: string | null;
};

export type PedroConfigurationPlan =
  | { status: "READY"; action: "NOOP" | "CONFIGURE"; reason: null }
  | { status: "STOP_NO_MUTATION" | "BLOCKED"; action: "STOP"; reason: string };

export function validatePedroOrganizationInputs(input: PedroOrganizationInputs): PedroOrganizationInputs {
  const normalized = {
    name: input.name.trim(),
    slug: input.slug.trim().toLowerCase(),
    timeZone: input.timeZone.trim(),
    currency: input.currency.trim().toUpperCase(),
    ownerEmail: input.ownerEmail.trim().toLowerCase(),
  };
  if (!normalized.name || normalized.name.length > 120) throw new Error("POLICYDESK_PEDRO_ORGANIZATION_NAME_INVALID");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized.slug) || normalized.slug.length < 3 || normalized.slug.length > 63) {
    throw new Error("POLICYDESK_PEDRO_ORGANIZATION_SLUG_INVALID");
  }
  if (!/^[A-Z]{3}$/.test(normalized.currency)) throw new Error("POLICYDESK_PEDRO_ORGANIZATION_CURRENCY_INVALID");
  try {
    Intl.DateTimeFormat("en-US", { timeZone: normalized.timeZone }).format();
  } catch {
    throw new Error("POLICYDESK_PEDRO_ORGANIZATION_TIME_ZONE_INVALID");
  }
  if (!normalized.ownerEmail.includes("@")) throw new Error("POLICYDESK_PEDRO_OWNER_EMAIL_INVALID");
  return normalized;
}

export function getPedroOrganizationMetadataChanges(
  current: PedroOrganizationCurrentMetadata,
  proposed: PedroOrganizationMetadata,
): PedroOrganizationMetadataChanges {
  const fields: Array<[keyof PedroOrganizationMetadata, string | null, string]> = [
    ["name", current.name, proposed.name],
    ["slug", current.slug, proposed.slug],
    ["timeZone", current.timeZone, proposed.timeZone],
    ["currency", current.currency, proposed.currency],
  ];
  return Object.fromEntries(
    fields
      .filter(([, from, to]) => from !== to)
      .map(([field, from, to]) => [field, { from, to }]),
  ) as PedroOrganizationMetadataChanges;
}

export function planPedroConfiguration(snapshot: PedroOrganizationSnapshot): PedroConfigurationPlan {
  if (snapshot.organizationId !== PEDRO_ORGANIZATION_ID) {
    return { status: "STOP_NO_MUTATION", action: "STOP", reason: "POLICYDESK_PEDRO_BOOTSTRAP_ORGANIZATION_MISSING" };
  }
  if (snapshot.organizationStatus !== "ACTIVE") {
    return { status: "STOP_NO_MUTATION", action: "STOP", reason: "POLICYDESK_PEDRO_ORGANIZATION_NOT_ACTIVE" };
  }
  if (snapshot.nonTechnicalUsers !== 1 || snapshot.nonTechnicalUserIds[0] !== snapshot.pedroUserId) {
    return { status: "BLOCKED", action: "STOP", reason: "POLICYDESK_PEDRO_USERS_NOT_EXCLUSIVE" };
  }
  if (!snapshot.pedroUserId || !snapshot.pedroActive) {
    return { status: "BLOCKED", action: "STOP", reason: "POLICYDESK_PEDRO_OWNER_NOT_ACTIVE" };
  }
  if (snapshot.pedroLegacyRole !== "ADMIN") {
    return { status: "BLOCKED", action: "STOP", reason: "POLICYDESK_PEDRO_OWNER_LEGACY_ROLE_INVALID" };
  }
  if (snapshot.ownerCount > 1 || (snapshot.ownerUserId && snapshot.ownerUserId !== snapshot.pedroUserId)) {
    return { status: "BLOCKED", action: "STOP", reason: "POLICYDESK_PEDRO_OWNER_REASSIGNMENT_REQUIRES_CUTOVER" };
  }
  if (snapshot.ownerCount !== 1 || snapshot.ownerUserId !== snapshot.pedroUserId || snapshot.pedroMembershipRole !== "OWNER" || snapshot.pedroMembershipActive !== true) {
    return { status: "BLOCKED", action: "STOP", reason: "POLICYDESK_PEDRO_OWNER_MEMBERSHIP_REQUIRED" };
  }
  if (snapshot.tenantNullCount > 0 || !snapshot.tenantAuditOk) {
    return { status: "STOP_NO_MUTATION", action: "STOP", reason: "POLICYDESK_PEDRO_TENANT_AUDIT_REQUIRED" };
  }
  return { status: "READY", action: "NOOP", reason: null };
}
