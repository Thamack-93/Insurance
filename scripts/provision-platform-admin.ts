import "dotenv/config";
import { randomBytes, scryptSync } from "node:crypto";
import { Pool } from "pg";

const EMAIL = (process.env.PLATFORM_ADMIN_EMAIL ?? "admin@policydesk.local").trim().toLowerCase();
const NAME = (process.env.PLATFORM_ADMIN_NAME ?? "Admin Demo").trim();

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return { apply: args.has("--apply"), json: args.has("--json") };
}

function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

function connectionString() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!value) throw new Error("PLATFORM_ADMIN_DATABASE_URL_REQUIRED");
  return value;
}

async function main() {
  const { apply, json } = parseArgs();
  if (apply && process.env.ALLOW_PLATFORM_ADMIN_PROVISION !== "1") throw new Error("PLATFORM_ADMIN_PROVISION_REQUIRES_EXPLICIT_AUTHORIZATION");
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string; email: string; name: string; role: string; platformRole: string; active: boolean }>(
      `SELECT "id","email","name","role","platformRole","active" FROM "User" WHERE lower("email") = $1`, [EMAIL],
    );
    if (existing.rowCount && existing.rows.length > 1) throw new Error("PLATFORM_ADMIN_EMAIL_NOT_UNIQUE");
    const current = existing.rows[0];
    let result: Record<string, unknown>;
    if (current) {
      result = { action: apply ? "promoted" : "would_promote", userId: current.id, email: current.email, previousPlatformRole: current.platformRole, previousActive: current.active, membershipCreated: false };
      if (apply) {
        await client.query(`UPDATE "User" SET "platformRole" = 'SUPERADMIN', "active" = true, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [current.id]);
        const ownerMembership = await client.query<{ id: string }>(`SELECT "id" FROM "OrganizationMembership" WHERE "userId" = $1 AND "role" = 'OWNER' AND "active"`, [current.id]);
        if (ownerMembership.rowCount) throw new Error("PLATFORM_ADMIN_CANNOT_BE_TENANT_OWNER");
        await client.query(`DELETE FROM "OrganizationMembership" WHERE "userId" = $1`, [current.id]);
      }
    } else {
      if (!apply) {
        result = { action: "would_create", email: EMAIL, name: NAME, passwordRequired: true, membershipCreated: false };
      } else {
        const password = process.env.PLATFORM_ADMIN_PASSWORD;
        if (!password || password.length < 16) throw new Error("PLATFORM_ADMIN_PASSWORD_REQUIRED");
        const id = `platform-admin-${randomBytes(8).toString("hex")}`;
        await client.query(`INSERT INTO "User" ("id","email","name","passwordHash","role","platformRole","active") VALUES ($1,$2,$3,$4,'ADMIN','SUPERADMIN',true)`, [id, EMAIL, NAME, passwordHash(password)]);
        result = { action: "created", userId: id, email: EMAIL, membershipCreated: false };
      }
    }
    await client.query("COMMIT");
    const output = { mode: apply ? "apply" : "preview", ok: true, result };
    if (json) console.log(JSON.stringify(output, null, 2)); else console.log(`${apply ? "Admin de plataforma provisionado" : "Preview de provisioning"}: ${EMAIL}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const output = { mode: apply ? "apply" : "preview", ok: false, error: error instanceof Error ? error.message : "PLATFORM_ADMIN_PROVISION_FAILED" };
    if (json) console.error(JSON.stringify(output, null, 2)); else console.error(output.error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
