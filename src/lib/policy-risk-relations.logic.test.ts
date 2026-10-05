import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { syncPolicyRiskRelations } from "@/lib/policy-risk-relations";

describe("policy risk relation synchronization", () => {
  it("clears old assets and parties before projecting the new ramo", async () => {
    const calls: string[] = [];
    const tx = {
      policyInsuredAsset: {
        deleteMany: vi.fn(async () => { calls.push("delete-assets"); return { count: 1 }; }),
        createMany: vi.fn(async () => { calls.push("create-assets"); return { count: 1 }; }),
      },
      policyInsuredParty: {
        deleteMany: vi.fn(async () => { calls.push("delete-parties"); return { count: 1 }; }),
        createMany: vi.fn(async () => { calls.push("create-parties"); return { count: 1 }; }),
      },
    } as unknown as Prisma.TransactionClient;

    await syncPolicyRiskRelations(tx, "org-a", "policy-a", {
      version: 1,
      policyType: "GMM",
      data: {
        insuredPeople: [{ fullName: "Ana Pérez", birthDate: "", relationship: "" }],
        plan: "",
        insuredAmount: "",
        deductible: "",
        coinsurance: "",
      },
    });

    expect(calls).toEqual(["delete-assets", "delete-parties", "create-parties"]);
    expect(tx.policyInsuredAsset.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org-a", policyId: "policy-a" } });
    expect(tx.policyInsuredParty.deleteMany).toHaveBeenCalledWith({ where: { organizationId: "org-a", policyId: "policy-a" } });
    expect(tx.policyInsuredParty.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: "org-a", policyId: "policy-a", fullName: "Ana Pérez", isPrimary: true, sourceLabel: "Datos estructurados de póliza" }],
    });
  });

  it("removes both relation sets when the ramo has no projected relation model", async () => {
    const tx = {
      policyInsuredAsset: { deleteMany: vi.fn(async () => ({ count: 1 })), createMany: vi.fn() },
      policyInsuredParty: { deleteMany: vi.fn(async () => ({ count: 1 })), createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await syncPolicyRiskRelations(tx, "org-a", "policy-a", {
      version: 1,
      policyType: "FIANZAS",
      data: { obligation: "Garantía", contractNumber: "", beneficiary: "", bondedAmount: "", term: "" },
    });

    expect(tx.policyInsuredAsset.deleteMany).toHaveBeenCalledOnce();
    expect(tx.policyInsuredParty.deleteMany).toHaveBeenCalledOnce();
    expect(tx.policyInsuredAsset.createMany).not.toHaveBeenCalled();
    expect(tx.policyInsuredParty.createMany).not.toHaveBeenCalled();
  });

  it("clears old relations when the new ramo is still empty", async () => {
    const tx = {
      policyInsuredAsset: { deleteMany: vi.fn(async () => ({ count: 1 })), createMany: vi.fn() },
      policyInsuredParty: { deleteMany: vi.fn(async () => ({ count: 1 })), createMany: vi.fn() },
    } as unknown as Prisma.TransactionClient;

    await syncPolicyRiskRelations(tx, "org-a", "policy-a", {
      version: 1,
      policyType: "GMM",
      data: { insuredPeople: [], plan: "", insuredAmount: "", deductible: "", coinsurance: "" },
    });

    expect(tx.policyInsuredAsset.deleteMany).toHaveBeenCalledOnce();
    expect(tx.policyInsuredParty.deleteMany).toHaveBeenCalledOnce();
    expect(tx.policyInsuredAsset.createMany).not.toHaveBeenCalled();
    expect(tx.policyInsuredParty.createMany).not.toHaveBeenCalled();
  });
});
