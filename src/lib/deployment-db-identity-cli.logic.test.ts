import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const connectionString = "postgresql://unused:unused@127.0.0.1:5432/database_that_does_not_exist";
const baseArgs = [
  "--import",
  "tsx",
  "scripts/deployment-db-identity.ts",
  "--environment",
  "development",
  "--project-id",
  "local-project",
  "--branch-id",
  "local-branch",
  "--database",
  "database_that_does_not_exist",
  "--endpoint-id",
  "127",
  "--topology-only",
  "--json",
];

function run(extraArgs: string[] = []) {
  return spawnSync(process.execPath, [...baseArgs, ...extraArgs], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL_UNPOOLED: connectionString,
    },
    encoding: "utf8",
  });
}

describe("deployment identity topology-only CLI", () => {
  it("verifies identity inputs without opening the nonexistent database", () => {
    const result = run();

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: "topology-only",
      targetEnvironment: "development",
      providerTopologyVerified: false,
      databaseMutationAttempted: false,
    });
  });

  it("rejects topology-only combined with apply before any database access", () => {
    const result = run(["--apply"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--topology-only no puede combinarse/);
    expect(result.stderr).not.toContain(connectionString);
  });
});
