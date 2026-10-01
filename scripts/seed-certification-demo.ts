import { mkdir, writeFile } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Pool } from "pg";
import { DEMO_SEED_VERSION, seedDemoBaseline, validateDemoBaseline } from "../src/lib/demo-seed";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "../src/lib/organization-context";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

// Updates only the synthetic DEMO on the previously authorized source branch.
// It never changes runtime maintenance mode, privileges, users or credentials.
async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL_REQUIRED");
  const target = assertDisposableCertificationTarget(connectionString);
  const url = new URL(connectionString);
  const candidateSha = process.env.CERTIFICATION_CANDIDATE_SHA?.trim();
  if (!candidateSha || target.mode !== "neon" || target.branchName !== `cert-stage3-${candidateSha}`
    || decodeURIComponent(url.username) !== "policydesk_app") throw new Error("REQUIRES_EXACT_SOURCE_AND_RESTRICTED_ROLE");
  const organizationId = "org_demo_broker_0001";
  const adminUrl = process.env.DATABASE_ADMIN_URL?.trim();
  if (!adminUrl) throw new Error("DATABASE_ADMIN_URL_REQUIRED");
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    const marker = await admin.query<{ fingerprint: string }>('SELECT fingerprint FROM "__policydesk_tenant_isolation_run" WHERE run_id=$1', [target.runId]);
    if (marker.rowCount !== 1 || marker.rows[0].fingerprint !== target.fingerprint) throw new Error("CERTIFICATION_MARKER_MISMATCH");
  } finally { await admin.end(); }
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const roles = await db.$queryRaw<Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user
    `;
    if (roles[0]?.current_user !== "policydesk_app" || roles[0].rolsuper || roles[0].rolbypassrls) throw new Error("RUNTIME_ROLE_NOT_RESTRICTED");
    const result = await db.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.findUnique({
        where: { userId: "tenant-demo-owner" }, include: { user: true, organization: true },
      });
      if (!membership || membership.organizationId !== organizationId || membership.role !== "OWNER"
        || membership.organization.kind !== "DEMO" || membership.organization.status !== "ACTIVE"
        || !membership.active || !membership.user.active || membership.user.email !== "demo-owner@policydesk.local") {
        throw new Error("REQUIRES_ACTIVE_SYNTHETIC_DEMO_OWNER");
      }
      const context: OrganizationContext = {
        userId: membership.userId, userEmail: membership.user.email, userName: membership.user.name,
        userRole: membership.user.role, platformRole: membership.user.platformRole,
        organizationId, organizationName: membership.organization.name, organizationSlug: membership.organization.slug,
        organizationStatus: membership.organization.status, membershipId: membership.id, membershipRole: "OWNER",
      };
      await assertOrganizationContextInTransaction(tx, context, ["OWNER"]);
      await seedDemoBaseline(tx, organizationId, context.userId);
      const counts = await validateDemoBaseline(tx, organizationId);
      await tx.demoOrganizationState.upsert({
        where: { organizationId }, update: { seedVersion: DEMO_SEED_VERSION },
        create: { organizationId, seedVersion: DEMO_SEED_VERSION, trialEndsAt: new Date(Date.now() + 30 * 86_400_000) },
      });
      return counts;
    }, { timeout: 120_000, maxWait: 15_000 });
    const report = { status: "PASS", candidateSha, source: target, organizationId, runtimeRole: "policydesk_app", seedVersion: DEMO_SEED_VERSION, counts: result, completedAt: new Date().toISOString() };
    await mkdir("artifacts/tenant-certification", { recursive: true });
    await writeFile("artifacts/tenant-certification/demo-seed.json", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(report));
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error((error instanceof Error ? error.message : "DEMO_FIXTURE_SEED_FAILED").replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://[redacted]"));
  process.exitCode = 1;
});
