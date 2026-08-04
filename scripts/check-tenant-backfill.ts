import "dotenv/config";

import { Pool } from "pg";
import { auditTenantFoundation } from "../src/lib/tenant-organization-foundation.ts";

async function main() {
  const json = process.argv.includes("--json");
  const guardsOnly = process.argv.includes("--guards-only");
  const connectionString = (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)?.trim();
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED o DATABASE_URL es obligatorio.");
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await auditTenantFoundation(client, { requireActive: true, guardsOnly });
    await client.query("ROLLBACK");
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`Tenant audit: ${result.ok ? "PASS" : "FAIL"}`);
      for (const issue of result.issues) console.log(`- ${issue}`);
    }
    if (!result.ok) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
