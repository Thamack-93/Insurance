import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireUser = vi.hoisted(() => vi.fn());
const requirePortfolioReadScope = vi.hoisted(() => vi.fn());
const resolveAuthorizedNoraContext = vi.hoisted(() => vi.fn());
const buildAssistantReply = vi.hoisted(() => vi.fn());
const assertSameOrigin = vi.hoisted(() => vi.fn());
const checkDistributedRateLimit = vi.hoisted(() => vi.fn());
const getRequestIp = vi.hoisted(() => vi.fn());
const readJsonBody = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {
    status = 401;
  },
  requireUser,
}));
vi.mock("@/lib/portfolio-access", () => ({ requirePortfolioReadScope }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/nora-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/nora-context")>()),
  resolveAuthorizedNoraContext,
}));
vi.mock("@/lib/assistant", () => ({
  buildAssistantReply,
  getAssistantHomeSnapshot: vi.fn(),
}));
vi.mock("@/lib/request-guards", () => ({
  assertSameOrigin,
  checkDistributedRateLimit,
  getRequestIp,
  readJsonBody,
  RequestGuardError: class RequestGuardError extends Error {},
}));
vi.mock("@/lib/api-security", () => ({
  rateLimitResponse: vi.fn(),
  guardErrorResponse: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { POST } from "@/app/api/assistant/route";

const user = { id: "agent-1", role: "AGENT" };
const scope = { id: "agent-1", role: "AGENT", portfolioOwnerId: "agent-1" };

function assistantRequest(context: unknown, history?: Array<{ role: "user" | "assistant"; content: string }>) {
  return new NextRequest("http://localhost/api/assistant", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify({ message: "Revisa este contexto", context, history }),
  });
}

describe("Nora explicit context API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue(user);
    requirePortfolioReadScope.mockResolvedValue(scope);
    assertSameOrigin.mockReturnValue(undefined);
    checkDistributedRateLimit.mockResolvedValue({ allowed: true });
    getRequestIp.mockReturnValue("127.0.0.1");
    readJsonBody.mockImplementation(async (request: NextRequest) => request.json());
    buildAssistantReply.mockResolvedValue({ source: "local", reply: "Respuesta", sections: [], quickPrompts: [] });
  });

  it("rejects an explicit context that is foreign or nonexistent before asking Nora", async () => {
    resolveAuthorizedNoraContext.mockResolvedValue(null);

    const response = await POST(assistantRequest({ type: "receipt", id: "foreign-or-missing" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "El contexto de Nora no existe o no está autorizado." });
    expect(resolveAuthorizedNoraContext).toHaveBeenCalledWith(
      { type: "receipt", id: "foreign-or-missing" },
      "agent-1",
    );
    expect(buildAssistantReply).not.toHaveBeenCalled();
  });

  it("uses a server-authorized context rather than trusting a client-supplied label", async () => {
    resolveAuthorizedNoraContext.mockResolvedValue({ type: "policy", id: "policy-1", label: "POL-001" });

    const response = await POST(assistantRequest({ type: "policy", id: "policy-1" }));

    expect(response.status).toBe(200);
    expect(buildAssistantReply).toHaveBeenCalledWith(
      { id: "agent-1", role: "AGENT" },
      "Revisa este contexto",
      { contextText: "policy POL-001", gmmMetadataOnly: false, history: undefined },
    );
  });

  it("passes at most the validated recent history to Nora", async () => {
    resolveAuthorizedNoraContext.mockResolvedValue(null);
    const history = [
      { role: "user" as const, content: "Busca la póliza POL-001" },
      { role: "assistant" as const, content: "¿Qué quieres revisar?" },
    ];

    const response = await POST(assistantRequest(null, history));

    expect(response.status).toBe(200);
    expect(buildAssistantReply).toHaveBeenCalledWith(
      { id: "agent-1", role: "AGENT" },
      "Revisa este contexto",
      { contextText: null, gmmMetadataOnly: false, history },
    );
  });

  it("rejects history longer than 6,000 characters", async () => {
    const response = await POST(assistantRequest(null, [
      { role: "user", content: "a".repeat(2_000) },
      { role: "assistant", content: "b".repeat(2_000) },
      { role: "user", content: "c".repeat(2_000) },
      { role: "assistant", content: "d" },
    ]));

    expect(response.status).toBe(400);
    expect(buildAssistantReply).not.toHaveBeenCalled();
  });

  it("marks an authorized GMM context as metadata-only", async () => {
    resolveAuthorizedNoraContext.mockResolvedValue({ type: "claim", id: "claim-1", label: "SIN-001", policyType: "GMM" });

    const response = await POST(assistantRequest({ type: "claim", id: "claim-1" }));

    expect(response.status).toBe(200);
    expect(buildAssistantReply).toHaveBeenCalledWith(
      { id: "agent-1", role: "AGENT" },
      "Revisa este contexto",
      { contextText: "claim SIN-001", gmmMetadataOnly: true, history: undefined },
    );
  });
});
