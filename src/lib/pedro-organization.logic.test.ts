import { describe, expect, it } from "vitest";
import {
  PEDRO_ORGANIZATION_ID,
  planPedroConfiguration,
  validatePedroOrganizationInputs,
  type PedroOrganizationSnapshot,
} from "./pedro-organization.logic";

function snapshot(overrides: Partial<PedroOrganizationSnapshot> = {}): PedroOrganizationSnapshot {
  return {
    organizationStatus: "ACTIVE",
    organizationId: PEDRO_ORGANIZATION_ID,
    nonTechnicalUsers: 1,
    nonTechnicalUserIds: ["pedro"],
    ownerUserId: "pedro",
    ownerCount: 1,
    pedroUserId: "pedro",
    pedroActive: true,
    pedroLegacyRole: "ADMIN",
    pedroMembershipRole: "OWNER",
    pedroMembershipActive: true,
    tenantNullCount: 0,
    tenantAuditOk: true,
    ...overrides,
  };
}

describe("Pedro organization configuration", () => {
  it("normalizes and validates the approved identity", () => {
    expect(validatePedroOrganizationInputs({
      name: " Pedro Alfredo Gómez Lorenzo ",
      slug: "Pedro-Alfredo-Gomez-Lorenzo",
      timeZone: "Etc/GMT+6",
      currency: "mxn",
      ownerEmail: "PedroAGL93@GMAIL.COM",
    })).toEqual({
      name: "Pedro Alfredo Gómez Lorenzo",
      slug: "pedro-alfredo-gomez-lorenzo",
      timeZone: "Etc/GMT+6",
      currency: "MXN",
      ownerEmail: "pedroagl93@gmail.com",
    });
  });

  it("is idempotent when Pedro is already the only active Owner", () => {
    expect(planPedroConfiguration(snapshot())).toEqual({ status: "READY", action: "NOOP", reason: null });
  });

  it("blocks any non-Pedro tenant user before mutation", () => {
    expect(planPedroConfiguration(snapshot({ nonTechnicalUsers: 2, nonTechnicalUserIds: ["pedro", "other"] }))).toEqual({
      status: "BLOCKED",
      action: "STOP",
      reason: "POLICYDESK_PEDRO_USERS_NOT_EXCLUSIVE",
    });
  });

  it("blocks an Owner reassignment while singleton guards are active", () => {
    expect(planPedroConfiguration(snapshot({ ownerUserId: "other" }))).toEqual({
      status: "BLOCKED",
      action: "STOP",
      reason: "POLICYDESK_PEDRO_OWNER_REASSIGNMENT_REQUIRES_CUTOVER",
    });
  });

  it("blocks null tenant rows or an audit failure", () => {
    expect(planPedroConfiguration(snapshot({ tenantNullCount: 1 }))).toEqual({
      status: "STOP_NO_MUTATION",
      action: "STOP",
      reason: "POLICYDESK_PEDRO_TENANT_AUDIT_REQUIRED",
    });
  });

  it("does not bypass the singleton Owner guard while the organization is Bootstrap", () => {
    expect(planPedroConfiguration(snapshot({ organizationStatus: "BOOTSTRAP" }))).toEqual({
      status: "STOP_NO_MUTATION",
      action: "STOP",
      reason: "POLICYDESK_PEDRO_ORGANIZATION_NOT_ACTIVE",
    });
  });
});
