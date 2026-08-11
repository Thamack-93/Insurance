import { describe, expect, it, vi } from "vitest";
import {
  NeonTopologyVerificationError,
  requireProtectedProductionReference,
  verifyNeonTarget,
} from "../../scripts/deployment-db-neon";

function response(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

describe("Neon deployment topology verification", () => {
  it("allows an unprotected Production reference only for an explicitly opted-in Preview", () => {
    expect(requireProtectedProductionReference({
      environment: "preview",
      allowUnprotectedPreviewReference: true,
    })).toBe(false);
    expect(() => requireProtectedProductionReference({
      environment: "production",
      allowUnprotectedPreviewReference: true,
    })).toThrow(/solo puede usarse para preparar Preview/);
    expect(requireProtectedProductionReference({
      environment: "preview",
      allowUnprotectedPreviewReference: false,
    })).toBe(true);
  });

  it("derives the database identity only after endpoint, branch and database agree", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/endpoints")) return response({ endpoints: [{ id: "ep-preview", project_id: "project-1", branch_id: "branch-preview", host: "ep-preview.us-east-2.aws.neon.tech", type: "read_write", disabled: false }] });
      if (path.endsWith("/branches/branch-preview")) return response({ branch: { id: "branch-preview", project_id: "project-1", protected: false } });
      return response({ databases: [{ id: 4711, branch_id: "branch-preview", name: "policydesk" }] });
    }) as unknown as typeof fetch;

    await expect(verifyNeonTarget({
      apiKey: "not-logged",
      connectionString: "postgresql://user:secret@ep-preview.us-east-2.aws.neon.tech/policydesk?sslmode=require",
      projectId: "project-1",
      branchId: "branch-preview",
      endpointId: "ep-preview",
      databaseName: "policydesk",
      fetchImpl,
    })).resolves.toMatchObject({ databaseId: "4711", branchId: "branch-preview", endpointId: "ep-preview" });
  });

  it("fails closed without leaking provider responses when topology differs", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/endpoints")) return response({ endpoints: [{ id: "ep-preview", project_id: "project-1", branch_id: "wrong-branch", type: "read_write" }] });
      if (path.endsWith("/branches/branch-preview")) return response({ branch: { id: "branch-preview", project_id: "project-1", protected: false } });
      return response({ databases: [{ id: 4711, branch_id: "branch-preview", name: "policydesk" }] });
    }) as unknown as typeof fetch;
    const error = await verifyNeonTarget({
      apiKey: "provider-secret",
      connectionString: "postgresql://user:db-secret@ep-preview.neon.tech/policydesk",
      projectId: "project-1",
      branchId: "branch-preview",
      endpointId: "ep-preview",
      fetchImpl,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(NeonTopologyVerificationError);
    expect(String(error)).not.toMatch(/provider-secret|db-secret|wrong-branch/);
  });

  it("retries transient Neon API failures", async () => {
    let endpointAttempts = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/endpoints")) {
        endpointAttempts += 1;
        if (endpointAttempts < 3) return response({ provider: "unavailable" }, 503);
        return response({ endpoints: [{ id: "ep-preview", project_id: "project-1", branch_id: "branch-preview", host: "ep-preview.neon.tech", type: "read_write" }] });
      }
      if (path.endsWith("/branches/branch-preview")) return response({ branch: { id: "branch-preview", project_id: "project-1", protected: false } });
      return response({ databases: [{ id: 4711, branch_id: "branch-preview", name: "policydesk" }] });
    }) as unknown as typeof fetch;
    await expect(verifyNeonTarget({
      apiKey: "secret",
      connectionString: "postgresql://user:password@ep-preview.neon.tech/policydesk",
      projectId: "project-1",
      branchId: "branch-preview",
      endpointId: "ep-preview",
      fetchImpl,
    })).resolves.toMatchObject({ databaseId: "4711" });
    expect(endpointAttempts).toBe(3);
  });

  it("requires Production to be protected", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.endsWith("/endpoints")) return response({ endpoints: [{ id: "ep-prod", project_id: "project-1", branch_id: "branch-prod", host: "ep-prod.neon.tech", type: "read_write" }] });
      if (path.endsWith("/branches/branch-prod")) return response({ branch: { id: "branch-prod", project_id: "project-1", protected: false } });
      return response({ databases: [{ id: 1, branch_id: "branch-prod", name: "policydesk" }] });
    }) as unknown as typeof fetch;
    await expect(verifyNeonTarget({
      apiKey: "secret",
      connectionString: "postgresql://user:password@ep-prod.neon.tech/policydesk",
      projectId: "project-1",
      branchId: "branch-prod",
      endpointId: "ep-prod",
      requireProtected: true,
      fetchImpl,
    })).rejects.toThrow(/protegida/);
  });
});
