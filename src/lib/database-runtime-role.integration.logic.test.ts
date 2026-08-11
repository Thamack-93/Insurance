import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const enabled = process.env.DEPLOYMENT_SAFETY_INTEGRATION === "1";

function runtimeUrl(adminUrl: string, role: string, password: string) {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function provision(adminUrl: string, applicationUrl: string, role: string, apply: boolean) {
  return execFileAsync(process.execPath, [
    "--import", "tsx", "scripts/provision-database-runtime-role.ts",
    ...(apply ? ["--apply"] : []),
    "--role-name", role,
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      DATABASE_URL_UNPOOLED: adminUrl,
      DATABASE_RUNTIME_URL: applicationUrl,
    },
    maxBuffer: 2 * 1024 * 1024,
  });
}

describe.skipIf(!enabled)("restricted PostgreSQL runtime role", () => {
  it("serializes provisioning and permits CRUD without identity, migration, truncate or DDL authority", async () => {
    const adminUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");
    const suffix = `${process.pid}_${Date.now()}`;
    const role = `policydesk_runtime_${suffix}`;
    const password = randomBytes(24).toString("base64url");
    const applicationUrl = runtimeUrl(adminUrl, role, password);
    const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
    try {
      const preview = await provision(adminUrl, applicationUrl, role, false);
      expect(preview.stdout).toContain("mode: preview");
      expect((await adminPool.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists", [role])).rows[0]?.exists).toBe(false);

      await Promise.all([
        provision(adminUrl, applicationUrl, role, true),
        provision(adminUrl, applicationUrl, role, true),
      ]);

      const runtimePool = new Pool({ connectionString: applicationUrl, max: 1 });
      try {
        const key = `runtime-role-${suffix}`;
        await runtimePool.query(`INSERT INTO "SystemSetting" (id,key,value,"createdAt","updatedAt") VALUES ($1,$2,'created',now(),now())`, [`runtime-setting-${suffix}`, key]);
        await runtimePool.query(`UPDATE "SystemSetting" SET value='updated' WHERE key=$1`, [key]);
        expect((await runtimePool.query<{ value: string }>(`SELECT value FROM "SystemSetting" WHERE key=$1`, [key])).rows[0]?.value).toBe("updated");
        await runtimePool.query(`DELETE FROM "SystemSetting" WHERE key=$1`, [key]);

        await expect(runtimePool.query(`UPDATE "DeploymentIdentity" SET "updatedAt"=now()`)).rejects.toThrow();
        await expect(runtimePool.query(`SELECT * FROM "_prisma_migrations" LIMIT 1`)).rejects.toThrow();
        await expect(runtimePool.query(`TRUNCATE "SystemSetting"`)).rejects.toThrow();
        await expect(runtimePool.query(`CREATE TABLE runtime_role_forbidden(id text)`)).rejects.toThrow();
      } finally {
        await runtimePool.end();
      }
    } finally {
      const identifier = `"${role.replaceAll('"', '""')}"`;
      await adminPool.query(`DROP OWNED BY ${identifier}`).catch(() => undefined);
      await adminPool.query(`DROP ROLE IF EXISTS ${identifier}`).catch(() => undefined);
      await adminPool.end();
    }
  });
});
