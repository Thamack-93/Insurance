import "dotenv/config";

import { randomBytes, scryptSync } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  DEFAULT_PLATFORM_ADMIN_EMAIL,
  DEFAULT_PLATFORM_ADMIN_ID,
  normalizePlatformAdminEmail,
  planPlatformAdminProvisioning,
  validatePlatformAdminPassword,
  type PlatformAdminSnapshot,
} from "../src/lib/platform-admin-provisioning.logic.ts";
import { generateTemporaryPassword, temporaryPasswordExpiresAt } from "../src/lib/password-policy.ts";

const LOCK_KEY = "policydesk-platform-admin-provision";

function args() {
  const values = new Set(process.argv.slice(2));
  const value = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3).trim();
  return { apply: values.has("--apply"), json: values.has("--json"), rotatePassword: values.has("--rotate-password"), resetTemporary: values.has("--reset-temporary"), operator: value("operator"), reason: value("reason"), confirmEmail: value("confirm-email"), email: value("email") };
}

function connectionString() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("POLICYDESK_PLATFORM_ADMIN_DIRECT_DATABASE_REQUIRED");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname)) throw new Error("POLICYDESK_PLATFORM_ADMIN_DIRECT_DATABASE_REQUIRED");
  return value;
}

function guardApplyTarget(value: string) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  if (loopback) return;
  const target = [process.env.SCRIPT_TARGET_ENV, process.env.DATABASE_ENV, process.env.VERCEL_ENV].filter(Boolean).join(" ");
  if (/production|prod/i.test(target)) {
    if (process.env.ALLOW_PLATFORM_ADMIN_PRODUCTION !== "1") throw new Error("POLICYDESK_PLATFORM_ADMIN_PRODUCTION_NOT_AUTHORIZED");
    return;
  }
  if (!/preview|staging|temporary|temp|test/i.test(target)) throw new Error("POLICYDESK_PLATFORM_ADMIN_TARGET_NOT_EXPLICIT");
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function readSnapshot(client: PoolClient, email: string, lock = false): Promise<{ userId: string | null; snapshot: PlatformAdminSnapshot }> {
  const user = await client.query<{ id: string; active: boolean; platformRole: string }>(
    `SELECT "id","active","platformRole" FROM "User" WHERE lower("email") = $1${lock ? " FOR UPDATE" : ""}`,
    [email],
  );
  const row = user.rows[0];
  if (!row) return { userId: null, snapshot: { exists: false, active: false, platformRole: "NONE", membershipRoles: [], operationalAssignments: 0 } };
  const [memberships] = await Promise.all([
    client.query<{ role: string }>(`SELECT "role" FROM "OrganizationMembership" WHERE "userId" = $1 ORDER BY "role"`, [row.id]),
  ]);
  return {
    userId: row.id,
    snapshot: {
      exists: true,
      active: row.active,
      platformRole: row.platformRole,
      membershipRoles: memberships.rows.map(({ role }) => role),
      operationalAssignments: 0,
    },
  };
}

async function verifyPlatformPolicy(client: PoolClient) {
  const result = await client.query<{ definition: string }>(`
    SELECT pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'policydesk_sync_user_membership'
  `);
  if (!result.rows[0]?.definition.includes('NEW."platformRole" = \'SUPERADMIN\'')) {
    throw new Error("POLICYDESK_SUPERADMIN_MEMBERSHIP_POLICY_NOT_INSTALLED");
  }
}

async function main() {
  const { apply, json, rotatePassword, resetTemporary, operator, reason, confirmEmail, email: emailArg } = args();
  const email = normalizePlatformAdminEmail(emailArg ?? process.env.PLATFORM_ADMIN_EMAIL ?? DEFAULT_PLATFORM_ADMIN_EMAIL);
  if (resetTemporary) {
    if (!operator || !reason || reason.length < 8 || !confirmEmail || normalizePlatformAdminEmail(confirmEmail) !== email) {
      throw new Error("POLICYDESK_PLATFORM_ADMIN_RECOVERY_REQUIRES_OPERATOR_REASON_AND_EMAIL_CONFIRMATION");
    }
  }
  const connection = connectionString();
  if (apply) guardApplyTarget(connection);
  const pool = new Pool({ connectionString: connection, max: 1 });
  const client = await pool.connect();
  try {
    await verifyPlatformPolicy(client);
    const initial = await readSnapshot(client, email);
    const initialPlan = planPlatformAdminProvisioning(initial.snapshot);
    if (!apply) {
      const payload = { ok: true, mode: "preview", email, action: initialPlan.action, requiresPassword: initialPlan.requiresPassword, active: initial.snapshot.active, platformRole: initial.snapshot.platformRole, membershipCount: initial.snapshot.membershipRoles.length };
      console.log(json ? JSON.stringify(payload, null, 2) : `Preview: ${payload.action} ${email}; memberships=${payload.membershipCount}.`);
      return;
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout = '30s'");
    await client.query("SET LOCAL statement_timeout = '2min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
    const current = await readSnapshot(client, email, true);
    const plan = planPlatformAdminProvisioning(current.snapshot);
    if (resetTemporary && !current.userId) throw new Error("POLICYDESK_PLATFORM_ADMIN_TEMPORARY_REQUIRES_EXISTING_USER");
    let operatorId: string | null = null;
    if (resetTemporary) {
      const operatorResult = await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE "id" = $1 AND "active" AND "platformRole" = 'SUPERADMIN'`, [operator]);
      operatorId = operatorResult.rows[0]?.id ?? null;
      if (!operatorId || operatorId === current.userId) throw new Error("POLICYDESK_PLATFORM_ADMIN_RECOVERY_OPERATOR_INVALID");
    }
    const temporaryPassword = resetTemporary ? generateTemporaryPassword() : null;
    const password = temporaryPassword ?? (plan.requiresPassword || rotatePassword
      ? validatePlatformAdminPassword(process.env.PLATFORM_ADMIN_PASSWORD)
      : null);

    if (!current.userId) {
      const idConflict = await client.query(`SELECT 1 FROM "User" WHERE "id" = $1`, [DEFAULT_PLATFORM_ADMIN_ID]);
      if (idConflict.rowCount) throw new Error("POLICYDESK_PLATFORM_ADMIN_ID_CONFLICT");
      await client.query(
        `INSERT INTO "User" ("id","email","name","passwordHash","role","platformRole","active","mustChangePassword","temporaryPasswordExpiresAt","sessionVersion","updatedAt") VALUES ($1,$2,$3,$4,'ADMIN','SUPERADMIN',true,$5,$6,0,CURRENT_TIMESTAMP)`,
        [DEFAULT_PLATFORM_ADMIN_ID, email, "Admin Demo", hashPassword(password!), Boolean(temporaryPassword), temporaryPassword ? temporaryPasswordExpiresAt() : null],
      );
    } else if (password) {
      await client.query(`UPDATE "User" SET "platformRole"='SUPERADMIN',"active"=true,"passwordHash"=$2,"mustChangePassword"=$3,"temporaryPasswordExpiresAt"=$4,"sessionVersion"="sessionVersion"+1,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [current.userId, hashPassword(password), Boolean(temporaryPassword), temporaryPassword ? temporaryPasswordExpiresAt() : null]);
    } else {
      await client.query(`UPDATE "User" SET "platformRole"='SUPERADMIN',"active"=true,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [current.userId]);
    }

    if (temporaryPassword && current.userId) {
      await client.query(`INSERT INTO "PlatformAuditLog" ("id","actorUserId","targetUserId","action","reason") VALUES ($1,$2,$3,'SUPERADMIN_TEMPORARY_PASSWORD_RESET',$4)`, [`pal_${Date.now()}_${randomBytes(8).toString("hex")}`, operatorId, current.userId, reason]);
    }

    const final = await readSnapshot(client, email, true);
    if (!final.snapshot.exists || !final.snapshot.active || final.snapshot.platformRole !== "SUPERADMIN" || final.snapshot.membershipRoles.length !== 0) {
      throw new Error("POLICYDESK_PLATFORM_ADMIN_FINAL_STATE_INVALID");
    }
    await client.query("COMMIT");
    const payload = { ok: true, mode: "apply", email, action: plan.action, active: true, platformRole: "SUPERADMIN", membershipCount: 0, passwordRotated: Boolean(password), temporaryPassword };
    console.log(json ? JSON.stringify(payload, null, 2) : `Platform admin listo: ${email}; membership tenant=0.${temporaryPassword ? ` Contraseña temporal: ${temporaryPassword}` : ""}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error && /^POLICYDESK_[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "POLICYDESK_PLATFORM_ADMIN_PROVISION_FAILED";
    const payload = { ok: false, mode: apply ? "apply" : "preview", error: message };
    console.error(json ? JSON.stringify(payload, null, 2) : message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
