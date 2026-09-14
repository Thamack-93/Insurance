import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { buildMonthlyBillingMetrics } from "@/lib/platform-billing.logic";
import { getDb, resetDb } from "@/lib/db";

const execFileAsync = promisify(execFile);
const enabled = process.env.RESTORE_INTEGRATION === "1";
const requireSuperAdmin = vi.hoisted(() => vi.fn());
const platformBillingMutationsEnabled = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());
const BILLING_ORGANIZATION_ID = "org_legacy_singleton_0001";

const TestAuthError = vi.hoisted(() => class TestAuthError extends Error {});

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth", () => ({ requireSuperAdmin, AuthError: TestAuthError }));
vi.mock("@/lib/platform-billing", () => ({ platformBillingMutationsEnabled }));

import {
  assignPlatformSubscriptionAction,
  createPlatformPlanAction,
  recordPlatformChargeAction,
  transitionPlatformChargeAction,
} from "@/app/(platform)/platform/billing-actions";

function databaseUrl(adminUrl: string, database: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

async function migrate(url: string) {
  // The disposable application suite exercises singleton behavior. The
  // final RLS cutover and its extension are applied only by the dedicated
  // two-organization job under an explicit maintenance window.
  const target = new URL(url);
  const database = decodeURIComponent(target.pathname.replace(/^\//, "").split("?")[0]);
  const fingerprint = createHash("sha256")
    .update(`local-postgres:${process.env.TENANT_ISOLATION_RUN_ID}:${database}:${target.hostname}`)
    .digest("hex");
  await execFileAsync("node", ["scripts/migrate-singleton-ci.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: url,
      DATABASE_URL: url,
      DATABASE_URL_UNPOOLED: "",
      NODE_ENV: "test",
      CI: "true",
      GITHUB_ACTIONS: "true",
      TENANT_ISOLATION_DB_NAME: database,
      TENANT_ISOLATION_FINGERPRINT: fingerprint,
    },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function createDatabase(adminUrl: string, name: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try { await pool.query(`CREATE DATABASE "${name}"`); } finally { await pool.end(); }
}

async function dropDatabase(adminUrl: string, name: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try { await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await pool.end(); }
}

async function seed(url: string) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(`INSERT INTO "User" (id,email,name,"passwordHash",role,"platformRole",active,"createdAt","updatedAt") VALUES ('billing-admin','billing-admin@example.test','Billing Admin','fixture','ADMIN','SUPERADMIN',true,now(),now())`);
    await pool.query(`UPDATE "Organization" SET name = 'Billing Organization', slug = 'billing-org', status = 'ACTIVE', "updatedAt" = now() WHERE id = $1`, [BILLING_ORGANIZATION_ID]);
  } finally { await pool.end(); }
}

describe.skipIf(!enabled)("platform billing disposable PostgreSQL integration", () => {
  it("enforces authorization, idempotency, lifecycle and metrics", async () => {
    const adminUrl = process.env.RESTORE_INTEGRATION_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("RESTORE_INTEGRATION_ADMIN_URL or DATABASE_URL is required.");
    const name = `policydesk_tenant_test_billing_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, "").toLowerCase();
    const url = databaseUrl(adminUrl, name);
    try {
      await createDatabase(adminUrl, name);
      await migrate(url);
      await seed(url);
      process.env.DATABASE_URL = url;
      process.env.DATABASE_URL_UNPOOLED = "";
      await resetDb();
      requireSuperAdmin.mockResolvedValue({ id: "billing-admin", platformRole: "SUPERADMIN" });
      platformBillingMutationsEnabled.mockReturnValue(true);

      const planResult = await createPlatformPlanAction({ requestId: "billing-plan-1", code: "PRO", name: "Profesional", monthlyAmountMinor: "10000", currency: "MXN" });
      expect(planResult.ok).toBe(true);
      if (!planResult.ok) throw new Error(planResult.error);
      const repeatedPlan = await createPlatformPlanAction({ requestId: "billing-plan-1", code: "PRO", name: "Profesional", monthlyAmountMinor: "10000", currency: "MXN" });
      expect(repeatedPlan).toMatchObject({ ok: true, id: planResult.id });

      const subscriptionResult = await assignPlatformSubscriptionAction({ requestId: "billing-sub-1", organizationId: BILLING_ORGANIZATION_ID, planId: planResult.id, status: "ACTIVE", reason: "Alta inicial autorizada" });
      expect(subscriptionResult.ok).toBe(true);
      if (!subscriptionResult.ok) throw new Error(subscriptionResult.error);
      const repeatedSubscription = await assignPlatformSubscriptionAction({ requestId: "billing-sub-1", organizationId: BILLING_ORGANIZATION_ID, planId: planResult.id, status: "ACTIVE", reason: "Alta inicial autorizada" });
      expect(repeatedSubscription).toMatchObject({ ok: true, id: subscriptionResult.id });

      const secondPlan = await createPlatformPlanAction({ requestId: "billing-plan-2", code: "BASIC", name: "Básico", monthlyAmountMinor: "5000", currency: "MXN" });
      expect(secondPlan.ok).toBe(true);
      if (!secondPlan.ok) throw new Error(secondPlan.error);
      const replacement = await assignPlatformSubscriptionAction({ requestId: "billing-sub-2", organizationId: BILLING_ORGANIZATION_ID, planId: secondPlan.id, status: "ACTIVE", reason: "Cambio de plan autorizado" });
      expect(replacement.ok).toBe(true);
      if (!replacement.ok) throw new Error(replacement.error);

      const db = getDb();
      expect(await db.organizationSubscription.count({ where: { organizationId: BILLING_ORGANIZATION_ID, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } } })).toBe(1);
      expect(await db.organizationSubscription.count({ where: { organizationId: BILLING_ORGANIZATION_ID, status: "CANCELED" } })).toBe(1);

      const paid = await recordPlatformChargeAction({ requestId: "billing-charge-1", organizationId: BILLING_ORGANIZATION_ID, subscriptionId: replacement.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", amountMinor: "5000", currency: "MXN", status: "PAID", reason: "Cargo mensual autorizado" });
      expect(paid.ok).toBe(true);
      if (!paid.ok) throw new Error(paid.error);
      const pending = await recordPlatformChargeAction({ requestId: "billing-charge-2", organizationId: BILLING_ORGANIZATION_ID, periodStart: "2026-09-01", periodEnd: "2026-09-30", amountMinor: "5000", currency: "MXN", status: "PENDING", reason: "Cargo futuro autorizado" });
      expect(pending.ok).toBe(true);
      if (!pending.ok) throw new Error(pending.error);
      const voided = await transitionPlatformChargeAction({ requestId: "billing-charge-transition-1", chargeId: pending.id, status: "VOID", reason: "Anulación manual autorizada" });
      expect(voided).toMatchObject({ ok: true, id: pending.id });
      const mismatch = await recordPlatformChargeAction({ requestId: "billing-charge-mismatch", organizationId: BILLING_ORGANIZATION_ID, subscriptionId: replacement.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", amountMinor: "5000", currency: "USD", status: "PENDING", reason: "Moneda incompatible" });
      expect(mismatch).toEqual({ ok: false, error: "POLICYDESK_BILLING_CURRENCY_MISMATCH" });

      const subscriptionRows = await db.organizationSubscription.findMany({ where: { organizationId: BILLING_ORGANIZATION_ID }, select: { status: true, monthlyAmountMinor: true, currency: true, startedAt: true, endsAt: true } });
      const chargeRows = await db.billingCharge.findMany({ where: { organizationId: BILLING_ORGANIZATION_ID }, select: { status: true, amountMinor: true, currency: true, paidAt: true } });
      const [metric] = buildMonthlyBillingMetrics([new Date("2026-09-01T00:00:00.000Z")], subscriptionRows, chargeRows);
      expect(metric?.mrrByCurrency).toEqual({ MXN: 5000 });
      expect(metric?.cashByCurrency.MXN).toBeGreaterThanOrEqual(5000);

      requireSuperAdmin.mockRejectedValue(new TestAuthError("Esta acción requiere permisos de plataforma."));
      const unauthorized = await createPlatformPlanAction({ requestId: "billing-plan-unauthorized", code: "NOPE", name: "Nope", monthlyAmountMinor: "1", currency: "MXN" });
      expect(unauthorized).toEqual({ ok: false, error: "Esta acción requiere permisos de plataforma." });
    } finally {
      await resetDb();
      await dropDatabase(adminUrl, name);
    }
  }, 120_000);
});
