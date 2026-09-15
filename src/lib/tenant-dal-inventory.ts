/**
 * Domain ownership map for the tenant-DAL rollout.  The map is intentionally
 * kept in source control so a new protected query module cannot silently skip
 * a migration wave.  The checker expands directory prefixes and reports the
 * current call-site count for release evidence.
 */
export const TENANT_DAL_DOMAINS = [
  {
    wave: 1,
    id: "foundation-and-operations",
    prefixes: [
      "src/lib/organization-context.ts",
      "src/lib/tenant-dal.ts",
      "src/lib/dashboard-queries.ts",
      "src/lib/list-queries.ts",
      "src/lib/portfolio-queries.ts",
      "src/lib/search.ts",
      "src/lib/activity-log.ts",
      "src/lib/export-datasets.ts",
      "src/app/(dashboard)/dashboard/",
      "src/app/(dashboard)/reports/",
      "src/app/(dashboard)/activity/",
      "src/app/(dashboard)/portfolio/",
      "src/app/(dashboard)/operations/",
    ],
  },
  {
    wave: 2,
    id: "clients-policies",
    prefixes: [
      "src/lib/policy-families.ts",
      "src/lib/policy-capture-search.ts",
      "src/app/(dashboard)/clients/",
      "src/app/(dashboard)/insurers/",
      "src/app/(dashboard)/policies/",
      "src/app/(dashboard)/quotes/",
    ],
  },
  {
    wave: 3,
    id: "financial-operations",
    prefixes: [
      "src/lib/commissions.ts",
      "src/lib/payment-service.ts",
      "src/lib/payment-maintenance.ts",
      "src/lib/renewals.ts",
      "src/lib/renewal-board.ts",
      "src/lib/renewal-followups.ts",
      "src/lib/vigency-maintenance.ts",
      "src/app/(dashboard)/receipts/",
      "src/app/(dashboard)/payments/",
      "src/app/(dashboard)/commissions/",
      "src/app/(dashboard)/renewals/",
    ],
  },
  {
    wave: 4,
    id: "work-items-documents-quality",
    prefixes: [
      "src/lib/work-items.ts",
      "src/lib/work-item-resolvers.ts",
      "src/lib/work-queue.ts",
      "src/lib/claim-checklists.ts",
      "src/lib/data-quality.ts",
      "src/lib/data-quality-rules.ts",
      "src/lib/notifications.ts",
      "src/lib/notification-foundation.ts",
      "src/lib/ledger-import.ts",
      "src/app/(dashboard)/claims/",
      "src/app/(dashboard)/tasks/",
      "src/app/(dashboard)/documents/",
      "src/app/(dashboard)/data-quality/",
      "src/app/(dashboard)/notifications/",
    ],
  },
  {
    wave: 5,
    id: "assistant-and-integrations",
    prefixes: [
      "src/lib/assistant",
      "src/lib/nora",
      "src/lib/knowledge",
      "src/lib/telegram",
      "src/lib/qualitas",
      "src/lib/whatsapp",
      "src/app/api/assistant/",
      "src/app/api/nora/",
      "src/app/api/integrations/",
    ],
  },
  {
    wave: 6,
    id: "remaining-adapters-and-jobs",
    prefixes: [
      "src/app/(dashboard)/",
      "src/app/api/",
      "src/lib/",
    ],
  },
] as const;

export const TENANT_DAL_GLOBAL_MODULES = [
  "src/lib/auth.ts",
  "src/lib/db.ts",
  "src/lib/backup.ts",
  "src/lib/backup-restore.ts",
  "src/lib/platform-dashboard.ts",
  "src/lib/platform-billing.ts",
  "src/lib/platform-runtime-state.ts",
  "src/lib/tenant-organization-foundation.ts",
] as const;

export function tenantDalDomainForFile(file: string) {
  if (TENANT_DAL_GLOBAL_MODULES.includes(file as (typeof TENANT_DAL_GLOBAL_MODULES)[number])) return "platform-global";
  return TENANT_DAL_DOMAINS.find((domain) => domain.prefixes.some((prefix) => file === prefix || file.startsWith(prefix)))?.id ?? null;
}
