import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { syncPolicyRiskRelations } from "@/lib/policy-risk-relations";

describe("policy risk relation synchronization", () => {
  it("preserves existing asset IDs and updates projected details", async () => {
    const tx = {
      policyInsuredAsset: {
        findMany: vi.fn(async () => [{ id: "asset-1", assetType: "AUTO", description: "Honda Civic 2020", serialNumber: "VIN-1" }]),
        update: vi.fn(async () => ({})),
        create: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
      policyInsuredParty: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    } as unknown as Prisma.TransactionClient;

    await syncPolicyRiskRelations(tx, "org-a", "policy-a", {
      version: 1,
      policyType: "AUTO",
      data: {
        policyMode: "Individual",
        vehicles: [{ make: "Honda", model: "Civic", year: "2020", version: "EX", vin: "VIN-1", plates: "ABC", unitClass: "AUTO PARTICULAR" }],
      },
    });

    expect(tx.policyInsuredAsset.update).toHaveBeenCalledWith({
      where: { id: "asset-1", organizationId: "org-a", policyId: "policy-a" },
      data: { assetType: "AUTO", unitClass: "AUTO PARTICULAR", description: "Honda Civic 2020 EX Placas ABC", serialNumber: "VIN-1", isPrimary: true, organizationId: "org-a", policyId: "policy-a" },
    });
    expect(tx.policyInsuredAsset.create).not.toHaveBeenCalled();
    expect(tx.policyInsuredAsset.deleteMany).not.toHaveBeenCalled();
    expect(tx.policyInsuredParty.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org-a", policyId: "policy-a" } });
    expect(tx.policyInsuredParty.createMany).not.toHaveBeenCalled();
  });

  it("removes unmatched assets and both relation sets when the ramo has no projected relation model", async () => {
    const tx = {
      policyInsuredAsset: { findMany: vi.fn(async () => [{ id: "asset-1", assetType: "AUTO", description: "Auto", serialNumber: null }]), deleteMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(), create: vi.fn() },
      policyInsuredParty: { deleteMany: vi.fn(async () => ({ count: 1 })), createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await syncPolicyRiskRelations(tx, "org-a", "policy-a", {
      version: 1,
      policyType: "FIANZAS",
      data: { obligation: "Garantía", contractNumber: "", beneficiary: "", bondedAmount: "", term: "" },
    });

    expect(tx.policyInsuredAsset.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org-a", policyId: "policy-a", id: { in: ["asset-1"] } } });
    expect(tx.policyInsuredParty.deleteMany).toHaveBeenCalledOnce();
    expect(tx.policyInsuredAsset.create).not.toHaveBeenCalled();
    expect(tx.policyInsuredParty.createMany).not.toHaveBeenCalled();
  });

  it("removes old relations when the new ramo is still empty", async () => {
    const tx = {
      policyInsuredAsset: { findMany: vi.fn(async () => [{ id: "asset-old", assetType: "GMM", description: "Ana", serialNumber: null }]), deleteMany: vi.fn(async () => ({ count: 1 })), update: vi.fn(), create: vi.fn() },
      policyInsuredParty: { deleteMany: vi.fn(async () => ({ count: 1 })), createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await syncPolicyRiskRelations(tx, "org-a", "policy-a", {
      version: 1,
      policyType: "GMM",
      data: { insuredPeople: [], plan: "", insuredAmount: "", deductible: "", coinsurance: "" },
    });

    expect(tx.policyInsuredAsset.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org-a", policyId: "policy-a", id: { in: ["asset-old"] } } });
    expect(tx.policyInsuredParty.deleteMany).toHaveBeenCalledOnce();
    expect(tx.policyInsuredAsset.create).not.toHaveBeenCalled();
    expect(tx.policyInsuredParty.createMany).not.toHaveBeenCalled();
  });
});
