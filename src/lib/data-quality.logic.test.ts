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

import { getClientDataQualityScores } from "./data-quality";

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

    const [score] = await getClientDataQualityScores();

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

    const [score] = await getClientDataQualityScores();

    expect(score).toMatchObject({
      clienteId: "client-attention",
      score: 80,
      nivel: "Bueno",
    });
  });
});
