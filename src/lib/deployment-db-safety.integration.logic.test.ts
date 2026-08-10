import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { getDb, resetDb } from "@/lib/db";
import { DeploymentDatabaseSafetyError } from "@/lib/deployment-db-safety";

const enabled = process.env.DEPLOYMENT_SAFETY_INTEGRATION === "1";
const originalEnvironment = process.env.EXPECTED_DATABASE_ENV;
const originalFingerprint = process.env.EXPECTED_DATABASE_FINGERPRINT;

afterEach(async () => {
  process.env.EXPECTED_DATABASE_ENV = originalEnvironment;
  process.env.EXPECTED_DATABASE_FINGERPRINT = originalFingerprint;
  await resetDb();
});

describe.skipIf(!enabled)("deployment database safety against PostgreSQL", () => {
  it("allows every supported Prisma mutation mechanism for the exact identity", async () => {
    const suffix = randomUUID();
    const prefix = `deployment-safety-allowed-${suffix}`;
    const nestedUserId = `deployment-safety-user-${suffix}`;
    const db = getDb();

    try {
      await db.systemSetting.create({ data: { key: `${prefix}-create`, value: "allowed" } });
      await db.systemSetting.createMany({
        data: [
          { key: `${prefix}-many-a`, value: "allowed" },
          { key: `${prefix}-many-b`, value: "allowed" },
        ],
      });
      await db.systemSetting.upsert({
        where: { key: `${prefix}-upsert` },
        create: { key: `${prefix}-upsert`, value: "created" },
        update: { value: "updated" },
      });
      await db.user.create({
        data: {
          id: nestedUserId,
          email: `${nestedUserId}@example.invalid`,
          name: "Deployment safety nested create",
          passwordHash: "not-a-real-password",
          role: "AGENT",
          notificationChannels: {
            create: { type: `TEST_${suffix}`, isEnabled: false },
          },
        },
      });
      await db.systemSetting.updateMany({
        where: { key: { startsWith: prefix } },
        data: { value: "updated" },
      });
      await db.$transaction([
        db.systemSetting.create({ data: { key: `${prefix}-batch-a`, value: "allowed" } }),
        db.systemSetting.create({ data: { key: `${prefix}-batch-b`, value: "allowed" } }),
      ]);
      await db.$transaction(async (transaction) => {
        await transaction.systemSetting.create({ data: { key: `${prefix}-interactive`, value: "created" } });
        await transaction.systemSetting.update({
          where: { key: `${prefix}-interactive` },
          data: { value: "updated" },
        });
      });

      expect(await db.systemSetting.count({ where: { key: { startsWith: prefix } } })).toBe(7);
      expect(await db.notificationChannel.count({ where: { userId: nestedUserId } })).toBe(1);
    } finally {
      await db.systemSetting.deleteMany({ where: { key: { startsWith: prefix } } }).catch(() => undefined);
      await db.user.deleteMany({ where: { id: nestedUserId } }).catch(() => undefined);
    }
  });

  it("blocks create, update, delete, bulk, nested, upsert and transaction writes without persisting rows", async () => {
    const suffix = randomUUID();
    const prefix = `deployment-safety-blocked-${suffix}`;
    const nestedUserId = `deployment-safety-user-${suffix}`;

    await getDb().systemSetting.createMany({
      data: [
        { key: `${prefix}-existing-update`, value: "original" },
        { key: `${prefix}-existing-update-many`, value: "original" },
        { key: `${prefix}-existing-delete`, value: "original" },
        { key: `${prefix}-existing-delete-many`, value: "original" },
      ],
    });

    process.env.EXPECTED_DATABASE_FINGERPRINT = "f".repeat(64) === originalFingerprint
      ? "e".repeat(64)
      : "f".repeat(64);
    await resetDb();
    const db = getDb();
    const blocked = (operation: Promise<unknown>) => expect(operation).rejects.toBeInstanceOf(DeploymentDatabaseSafetyError);

    await blocked(db.systemSetting.create({ data: { key: `${prefix}-create`, value: "blocked" } }));
    await blocked(db.systemSetting.createMany({
      data: [
        { key: `${prefix}-many-a`, value: "blocked" },
        { key: `${prefix}-many-b`, value: "blocked" },
      ],
    }));
    await blocked(db.systemSetting.upsert({
      where: { key: `${prefix}-upsert` },
      create: { key: `${prefix}-upsert`, value: "blocked" },
      update: { value: "blocked" },
    }));
    await blocked(db.systemSetting.update({
      where: { key: `${prefix}-existing-update` },
      data: { value: "blocked" },
    }));
    await blocked(db.systemSetting.updateMany({
      where: { key: `${prefix}-existing-update-many` },
      data: { value: "blocked" },
    }));
    await blocked(db.systemSetting.delete({ where: { key: `${prefix}-existing-delete` } }));
    await blocked(db.systemSetting.deleteMany({ where: { key: `${prefix}-existing-delete-many` } }));
    await blocked(db.user.create({
      data: {
        id: nestedUserId,
        email: `${nestedUserId}@example.invalid`,
        name: "Deployment safety blocked nested create",
        passwordHash: "not-a-real-password",
        role: "AGENT",
        notificationChannels: { create: { type: `TEST_${suffix}`, isEnabled: false } },
      },
    }));
    await blocked(db.$transaction([
      db.systemSetting.create({ data: { key: `${prefix}-batch-a`, value: "blocked" } }),
      db.systemSetting.create({ data: { key: `${prefix}-batch-b`, value: "blocked" } }),
    ]));
    await blocked(db.$transaction(async (transaction) => {
      await transaction.systemSetting.create({ data: { key: `${prefix}-interactive`, value: "blocked" } });
    }));

    process.env.EXPECTED_DATABASE_FINGERPRINT = originalFingerprint;
    await resetDb();
    const restoredDb = getDb();
    expect(await restoredDb.systemSetting.findMany({
      where: { key: { startsWith: `${prefix}-existing-` } },
      select: { value: true },
    })).toEqual(Array.from({ length: 4 }, () => ({ value: "original" })));
    expect(await restoredDb.systemSetting.count({
      where: { key: { startsWith: prefix }, NOT: { key: { startsWith: `${prefix}-existing-` } } },
    })).toBe(0);
    expect(await restoredDb.user.count({ where: { id: nestedUserId } })).toBe(0);
    await restoredDb.systemSetting.deleteMany({ where: { key: { startsWith: prefix } } });
  });
});
