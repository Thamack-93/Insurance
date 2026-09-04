import { normalize } from "@/lib/search-utils";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";
import { normalizeCaptureIdentity, scoreCaptureIdentity } from "@/lib/policy-pdf-capture.shared";
import { requireOrganizationContext, withTenantTransaction, type TenantDb } from "@/lib/organization-context";

export type PolicyCaptureSearchKind = "client" | "insurer" | "policy";

export type PolicyCaptureSearchItem = {
  id: string;
  label: string;
  description: string;
  searchValue: string;
  meta?: {
    clientType?: string;
    rfc?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    clientId?: string | null;
    insurerId?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    clientName?: string | null;
    insurerName?: string | null;
    policyType?: string | null;
    policyNumber?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    serialNumber?: string | null;
    status?: string | null;
  };
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildRecentSearchValue(parts: Array<string | null | undefined>) {
  return compact(parts.filter(Boolean).join(" "));
}

function includesNormalized(haystack: string | null | undefined, needle: string) {
  if (!haystack) return false;
  return normalize(haystack).includes(needle);
}

async function searchClients(query: string, organizationId: string, portfolioOwnerId: string | null | undefined, db: TenantDb) {
  const needle = normalize(query);
  const databaseQuery = normalizeCaptureIdentity(query).split(" ").filter(Boolean).slice(0, 2).join(" ") || query;
  const baseWhere = {
    organizationId,
    status: { not: "ARCHIVED" as const },
    ...(portfolioOwnerId ? { portfolioOwnerId } : {}),
  };
  let rows = await db.client.findMany({
    where: needle
      ? {
          ...baseWhere,
          OR: [
            { fullName: { contains: databaseQuery, mode: "insensitive" } },
            { email: { contains: query, mode: "insensitive" } },
            { phone: { contains: query, mode: "insensitive" } },
            { secondaryPhone: { contains: query, mode: "insensitive" } },
            { rfc: { contains: query, mode: "insensitive" } },
            { address: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
          ],
        }
      : {
          ...baseWhere,
        },
    select: {
      id: true,
      fullName: true,
      type: true,
      email: true,
      phone: true,
      rfc: true,
      address: true,
      updatedAt: true,
    },
    orderBy: needle ? [{ updatedAt: "desc" }] : [{ fullName: "asc" }],
    take: 12,
  });
  if (needle && rows.length === 0) {
    const broadRows = await db.client.findMany({
      where: baseWhere,
      select: {
        id: true,
        fullName: true,
        type: true,
        email: true,
        phone: true,
        rfc: true,
        address: true,
        updatedAt: true,
      },
      orderBy: { fullName: "asc" },
      take: 500,
    });
    rows = broadRows
      .map((client) => ({ client, score: scoreCaptureIdentity(query, client.fullName) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.client.fullName.localeCompare(right.client.fullName))
      .slice(0, 12)
      .map((entry) => entry.client);
  }

  return rows.map((client) => ({
    id: client.id,
    label: client.fullName,
    description: buildRecentSearchValue([
      client.type === "COMPANY" ? "Empresa" : "Persona",
      client.rfc ? `RFC ${client.rfc}` : null,
      client.phone ? `Tel ${client.phone}` : null,
      client.email ?? null,
      client.address ? compact(client.address) : null,
    ]),
    searchValue: buildRecentSearchValue([client.fullName, client.rfc, client.phone, client.email, client.address]),
    meta: {
      clientType: client.type,
      rfc: client.rfc,
      email: client.email,
      phone: client.phone,
      address: client.address,
    },
  }));
}

async function searchInsurers(query: string, organizationId: string, db: TenantDb) {
  const needle = normalize(query);
  const databaseQuery = normalizeCaptureIdentity(query).split(" ").filter(Boolean).slice(0, 2).join(" ") || query;
  const baseWhere = { organizationId, status: { not: "ARCHIVED" as const } };
  let rows = await db.insurer.findMany({
    where: needle
      ? {
          ...baseWhere,
          OR: [
            { name: { contains: databaseQuery, mode: "insensitive" } },
            { contactName: { contains: query, mode: "insensitive" } },
            { contactEmail: { contains: query, mode: "insensitive" } },
            { contactPhone: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
          ],
        }
      : baseWhere,
    select: {
      id: true,
      name: true,
      contactName: true,
      contactEmail: true,
      contactPhone: true,
      updatedAt: true,
    },
    orderBy: needle ? [{ updatedAt: "desc" }] : [{ name: "asc" }],
    take: 12,
  });
  if (needle && rows.length === 0) {
    const broadRows = await db.insurer.findMany({
      where: baseWhere,
      select: {
        id: true,
        name: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        updatedAt: true,
      },
      orderBy: { name: "asc" },
      take: 200,
    });
    rows = broadRows
      .map((insurer) => ({ insurer, score: scoreCaptureIdentity(query, insurer.name) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.insurer.name.localeCompare(right.insurer.name))
      .slice(0, 12)
      .map((entry) => entry.insurer);
  }

  return rows.map((insurer) => ({
    id: insurer.id,
    label: insurer.name,
    description: buildRecentSearchValue([insurer.contactName, insurer.contactEmail, insurer.contactPhone]),
    searchValue: buildRecentSearchValue([insurer.name, insurer.contactName, insurer.contactEmail, insurer.contactPhone]),
    meta: {
      contactName: insurer.contactName,
      contactEmail: insurer.contactEmail,
      contactPhone: insurer.contactPhone,
    },
  }));
}

async function searchPolicies(
  query: string,
  filters: {
    organizationId: string;
    clientId?: string | null;
    insurerId?: string | null;
    portfolioOwnerId?: string | null;
  },
  db: TenantDb,
) {
  const needle = normalize(query);
  const policyNumberVariants = buildPolicyNumberSearchVariants(query);
  const identifierQuery = /^[A-Z0-9/-]{7,}$/i.test(query.replace(/\s+/g, ""));
  const clientFilter = filters?.clientId && !identifierQuery ? { clientId: filters.clientId } : {};
  const rows = await db.policy.findMany({
    where: needle
      ? {
          organizationId: filters.organizationId,
          ...(filters?.portfolioOwnerId ? { client: { portfolioOwnerId: filters.portfolioOwnerId } } : {}),
          ...clientFilter,
          ...(filters?.insurerId ? { insurerId: filters.insurerId } : {}),
          OR: [
            { policyNumber: { contains: query, mode: "insensitive" } },
            ...policyNumberVariants
              .filter((variant) => variant !== query)
              .map((variant) => ({ policyNumber: { contains: variant, mode: "insensitive" as const } })),
            { insuredObject: { contains: query, mode: "insensitive" } },
            { beneficiaryInfo: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
            { client: { is: { fullName: { contains: query, mode: "insensitive" } } } },
            { insurer: { is: { name: { contains: query, mode: "insensitive" } } } },
            { insuredAssets: { some: { serialNumber: { contains: query, mode: "insensitive" } } } },
          ],
        }
      : {
          organizationId: filters.organizationId,
          ...(filters?.portfolioOwnerId ? { client: { portfolioOwnerId: filters.portfolioOwnerId } } : {}),
          ...clientFilter,
          ...(filters?.insurerId ? { insurerId: filters.insurerId } : {}),
        },
    select: {
      id: true,
      clientId: true,
      insurerId: true,
      policyNumber: true,
      policyType: true,
      status: true,
      startDate: true,
      endDate: true,
      updatedAt: true,
      client: {
        select: {
          fullName: true,
        },
      },
      insurer: {
        select: {
          name: true,
        },
      },
      insuredAssets: {
        select: {
          serialNumber: true,
        },
        take: 1,
      },
    },
    orderBy: needle ? [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }] : [{ endDate: "desc" }, { startDate: "desc" }],
    take: 12,
  });

  return rows.map((policy) => ({
    id: policy.id,
    label: policy.policyNumber,
    description: buildRecentSearchValue([
      policy.client.fullName,
      policy.insurer.name,
      `${policy.startDate.toISOString().slice(0, 10)} · ${policy.endDate.toISOString().slice(0, 10)}`,
      policy.insuredAssets[0]?.serialNumber ? `Serie ${policy.insuredAssets[0].serialNumber}` : null,
      policy.status,
    ]),
    searchValue: buildRecentSearchValue([
      policy.policyNumber,
      policy.client.fullName,
      policy.insurer.name,
      policy.insuredAssets[0]?.serialNumber,
      policy.policyType,
      policy.status,
      policy.startDate.toISOString().slice(0, 10),
      policy.endDate.toISOString().slice(0, 10),
    ]),
    meta: {
      policyNumber: policy.policyNumber,
      clientId: policy.clientId,
      insurerId: policy.insurerId,
      policyType: policy.policyType,
      clientName: policy.client.fullName,
      insurerName: policy.insurer.name,
      startDate: policy.startDate.toISOString().slice(0, 10),
      endDate: policy.endDate.toISOString().slice(0, 10),
      serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      status: policy.status,
    },
  }));
}

export async function searchPolicyCaptureEntities(
  kind: PolicyCaptureSearchKind,
  query: string,
  filters: {
    organizationId: string;
    clientId?: string | null;
    insurerId?: string | null;
    portfolioOwnerId?: string | null;
  },
): Promise<PolicyCaptureSearchItem[]> {
  const normalizedQuery = query.trim();
  if (!filters.organizationId) return [];
  const context = await requireOrganizationContext();
  if (context.organizationId !== filters.organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  return withTenantTransaction(context, async (db) => {
    if (kind === "client") return searchClients(normalizedQuery, filters.organizationId, filters.portfolioOwnerId, db);
    if (kind === "insurer") return searchInsurers(normalizedQuery, filters.organizationId, db);
    if (kind === "policy") return searchPolicies(normalizedQuery, filters, db);
    return [];
  });
}

export function matchesPolicyCaptureItem(item: PolicyCaptureSearchItem, query: string) {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return includesNormalized(item.searchValue, needle) || includesNormalized(item.description, needle) || includesNormalized(item.label, needle);
}
