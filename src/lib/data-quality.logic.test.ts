import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

const clientFindMany = vi.hoisted(() => vi.fn());
const suppressionRuleFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => {
  return {
    getDb: () => ({
      client: {
        findMany: clientFindMany,
      },
      dataQualitySuppressionRule: {
        findMany: suppressionRuleFindMany,
      },
    }),
  };
});

import { getClientDataQualityScores, listActivePoliciesWithoutReceipts } from "./data-quality";

describe("active policies without receipts audit", () => {
  it("lists only active policies with the no-receipts issue", () => {
    const basePolicy = {
      poliza: "P-1",
      clienteId: "client-1",
      cliente: "Cliente",
      aseguradora: "Aseguradora",
      endDate: new Date("2027-01-01T00:00:00Z"),
      premiumAmount: 1000,
      paymentFrequency: "ANNUAL",
      insuredObject: null,
      notes: null,
      score: 80,
      nivel: "Bueno" as const,
      completitud: 80,
    };
    const noReceiptsIssue = {
      code: "POLICY_WITHOUT_RECEIPTS",
      etiqueta: "Sin recibos",
      descripcion: "La póliza no tiene recibos registrados.",
      penalizacion: 20,
    };
    const policies = [
      { ...basePolicy, polizaId: "active-empty", status: "ACTIVE", issues: [noReceiptsIssue] },
      { ...basePolicy, polizaId: "active-has-receipt", status: "ACTIVE", issues: [] },
      { ...basePolicy, polizaId: "renewed-empty", status: "RENEWED", issues: [noReceiptsIssue] },
    ];

    expect(listActivePoliciesWithoutReceipts(policies).map((policy) => policy.polizaId)).toEqual(["active-empty"]);
  });
});

describe("data-quality client scoring", () => {
  beforeEach(() => {
    clientFindMany.mockReset();
    suppressionRuleFindMany.mockReset();
    suppressionRuleFindMany.mockResolvedValue([]);
  });

  it("marks severely incomplete clients as critical", async () => {
    clientFindMany.mockResolvedValue([
      {
        id: "client-critical",
        fullName: "Cliente crítico",
        email: null,
        phone: null,
        secondaryPhone: null,
        address: null,
        rfc: null,
        preferredContactMethod: null,
        policies: [],
      },
    ]);

    const [score] = await getClientDataQualityScores("org-test");

    expect(score).toMatchObject({
      clienteId: "client-critical",
      score: 10,
      nivel: "Crítico",
    });
    expect(score.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "CLIENT_EMAIL_MISSING",
        "CLIENT_PHONE_MISSING",
        "CLIENT_ADDRESS_MISSING",
        "CLIENT_RFC_MISSING",
        "CLIENT_CONTACT_METHOD_MISSING",
        "CLIENT_WITHOUT_POLICY",
      ]),
    );
  });

  it("keeps lightly incomplete clients out of the critical bucket", async () => {
    clientFindMany.mockResolvedValue([
      {
        id: "client-attention",
        fullName: "Cliente atención",
        email: "cliente@example.com",
        phone: null,
        secondaryPhone: null,
        address: "Calle 1",
        rfc: "XAXX010101000",
        preferredContactMethod: "EMAIL",
        policies: [{ status: "ACTIVE", premiumAmount: 1200 }],
      },
    ]);

    const [score] = await getClientDataQualityScores("org-test");

    expect(score).toMatchObject({
      clienteId: "client-attention",
      score: 80,
      nivel: "Bueno",
    });
  });

  it("scopes client quality queries to the requested portfolio owner", async () => {
    clientFindMany.mockResolvedValue([
      {
        id: "client-scoped",
        fullName: "Cliente acotado",
        email: "cliente@example.com",
        phone: "5555555555",
        secondaryPhone: null,
        address: "Calle 2",
        rfc: "XAXX010101000",
        preferredContactMethod: "EMAIL",
        policies: [{ status: "ACTIVE", premiumAmount: 1200 }],
      },
    ]);

    await getClientDataQualityScores("org-test", "agent-1");

    expect(clientFindMany).toHaveBeenCalledWith({
      where: { organizationId: "org-test", portfolioOwnerId: "agent-1", status: "ACTIVE" },
      select: expect.any(Object),
    });
  });
});
