import { getDb } from "@/lib/db";
import { normalize } from "@/lib/search-utils";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";
import { normalizeCaptureIdentity } from "@/lib/policy-pdf-capture.shared";

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

async function searchClients(query: string, portfolioOwnerId?: string | null) {
  const db = getDb();
  const needle = normalize(query);
  const databaseQuery = normalizeCaptureIdentity(query).split(" ").filter(Boolean).slice(0, 2).join(" ") || query;
  const rows = await db.client.findMany({
    where: needle
      ? {
          status: { not: "ARCHIVED" },
          ...(portfolioOwnerId ? { portfolioOwnerId } : {}),
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
          status: { not: "ARCHIVED" },
          ...(portfolioOwnerId ? { portfolioOwnerId } : {}),
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

async function searchInsurers(query: string) {
  const db = getDb();
  const needle = normalize(query);
  const databaseQuery = normalizeCaptureIdentity(query).split(" ").filter(Boolean).slice(0, 2).join(" ") || query;
  const rows = await db.insurer.findMany({
    where: needle
      ? {
          status: { not: "ARCHIVED" },
          OR: [
            { name: { contains: databaseQuery, mode: "insensitive" } },
            { contactName: { contains: query, mode: "insensitive" } },
            { contactEmail: { contains: query, mode: "insensitive" } },
            { contactPhone: { contains: query, mode: "insensitive" } },
            { notes: { contains: query, mode: "insensitive" } },
          ],
        }
      : { status: { not: "ARCHIVED" } },
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
  filters?: { clientId?: string | null; insurerId?: string | null; portfolioOwnerId?: string | null },
) {
  const db = getDb();
  const needle = normalize(query);
  const policyNumberVariants = buildPolicyNumberSearchVariants(query);
  const rows = await db.policy.findMany({
    where: needle
      ? {
          ...(filters?.portfolioOwnerId ? { client: { portfolioOwnerId: filters.portfolioOwnerId } } : {}),
          ...(filters?.clientId ? { clientId: filters.clientId } : {}),
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
          ...(filters?.portfolioOwnerId ? { client: { portfolioOwnerId: filters.portfolioOwnerId } } : {}),
          ...(filters?.clientId ? { clientId: filters.clientId } : {}),
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
  filters?: { clientId?: string | null; insurerId?: string | null; portfolioOwnerId?: string | null },
): Promise<PolicyCaptureSearchItem[]> {
  const normalizedQuery = query.trim();
  if (kind === "client") return searchClients(normalizedQuery, filters?.portfolioOwnerId);
  if (kind === "insurer") return searchInsurers(normalizedQuery);
  if (kind === "policy") return searchPolicies(normalizedQuery, filters);
  return [];
}

export function matchesPolicyCaptureItem(item: PolicyCaptureSearchItem, query: string) {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return includesNormalized(item.searchValue, needle) || includesNormalized(item.description, needle) || includesNormalized(item.label, needle);
}
