import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  QUALITAS_PAYMENT_LINK_ENTRYPOINT,
  normalizeQualitasPolicyNumber,
  normalizeQualitasProviderOutcome,
  prepareQualitasPaymentLink,
  requestQualitasPaymentLink,
  type QualitasHttpTransport,
  type QualitasPreparedPaymentLink,
} from "./qualitas-payment-link";

const policyAction = "https://www.qualitas.com.mx/web/qmx/pago-de-poliza?p_p_id=pagopoliza_WAR_PagoPolizaportlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&_pagopoliza_WAR_PagoPolizaportlet_myaction=consulta-datos&p_auth=redacted";
const finalAction = "https://www.qualitas.com.mx/web/qmx/pago-de-poliza?p_p_id=pagopoliza_WAR_PagoPolizaportlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&_pagopoliza_WAR_PagoPolizaportlet_myaction=envia-link-pago&p_auth=redacted";
const resumeUrl = "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/resumen-ws";

const initialHtml = `<form method="post" action="${policyAction.replaceAll("&", "&amp;")}">
  <input type="hidden" name="dynamicField" value="dynamicValue">
  <input name="numPoliza" maxlength="10">
  <button type="submit">Buscar</button>
</form>`;

const contactHtml = `<form method="post" action="${finalAction.replaceAll("&", "&amp;")}">
  <input type="hidden" name="resumenWSUrl" value="${resumeUrl}">
  <input type="hidden" name="numTelefono" value="">
  <input name="temail" value="">
</form>`;

function response(body: string, status = 200, headers?: HeadersInit) {
  return new Response(body, { status, headers });
}

function sequenceTransport(responses: Response[]): { transport: QualitasHttpTransport; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: QualitasHttpTransport = vi.fn(async (input, init) => {
    calls.push({ url: input.toString(), init });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fake transport call");
    return next;
  });
  return { transport, calls };
}

async function prepareForFinal(transport: QualitasHttpTransport) {
  const prepared = await prepareQualitasPaymentLink(
    { policyNumber: "0000000000", recipientEmail: "agent@example.com" },
    { transport },
  );
  expect(prepared).toMatchObject({ transportReady: true });
  return prepared as QualitasPreparedPaymentLink;
}

describe("qualitas-payment-link provider", () => {
  it("pads stored nine-digit policy numbers for Quálitas", async () => {
    expect(normalizeQualitasPolicyNumber("940454748")).toBe("0940454748");

    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
    ]);

    const prepared = await prepareQualitasPaymentLink(
      { policyNumber: "940454748", recipientEmail: "agent@example.com" },
      { transport },
    );

    expect(prepared).toMatchObject({ transportReady: true, policyNumber: "0940454748" });
    expect((calls[1].init?.body as URLSearchParams).get("numPoliza")).toBe("0940454748");
  });

  it("discovers the session flow and sends the final multipart request", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml, 200, { "set-cookie": "JSESSIONID=session-only; Path=/" }),
      response(contactHtml, 200, { "set-cookie": "route=route-only; Path=/" }),
      response("Código: 0 Mensaje: Se genero link de pago y se envio al correo indicado."),
    ]);

    const prepared = await prepareForFinal(transport);
    const result = await requestQualitasPaymentLink(prepared, { transport });

    expect(result).toEqual({ outcome: "SUCCESS" });
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(QUALITAS_PAYMENT_LINK_ENTRYPOINT);
    expect(new URL(calls[1].url).searchParams.get("_pagopoliza_WAR_PagoPolizaportlet_myaction")).toBe("consulta-datos");
    expect(new URL(calls[2].url).searchParams.get("_pagopoliza_WAR_PagoPolizaportlet_myaction")).toBe("envia-link-pago");

    const policyBody = calls[1].init?.body as URLSearchParams;
    expect(policyBody.get("numPoliza")).toBe("0000000000");
    expect(policyBody.get("dynamicField")).toBe("dynamicValue");

    const finalBody = calls[2].init?.body as FormData;
    expect(finalBody).toBeInstanceOf(FormData);
    expect(finalBody.get("numTelefono")).toBe("");
    expect(finalBody.get("temail")).toBe("agent@example.com");
    expect(finalBody.get("resumenWSUrl")).toBe(resumeUrl);
    expect((calls[2].init?.headers as Headers).get("X-Pjax")).toBe("true");
    expect((calls[2].init?.headers as Headers).get("X-Requested-With")).toBe("XMLHttpRequest");
    expect((calls[2].init?.headers as Headers).has("Cookie")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("agent@example.com");
  });

  it("maps the provider duplicate response to UNCERTAIN without retrying", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response("Codigo: 99991 Mensaje: Error: Ya se encuentra otro link de pago en curso."),
    ]);
    const prepared = await prepareForFinal(transport);

    const result = await requestQualitasPaymentLink(prepared, { transport });

    expect(result).toEqual({ outcome: "UNCERTAIN" });
    expect(calls).toHaveLength(3);
  });

  it("fails closed on a cross-host redirect", async () => {
    const transport: QualitasHttpTransport = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/payment" } }),
    );

    await expect(prepareQualitasPaymentLink(
      { policyNumber: "0000000000", recipientEmail: "agent@example.com" },
      { transport },
    )).resolves.toEqual({ outcome: "QUALITAS_FLOW_CHANGED" });
  });

  it("maps representative redacted provider fixtures", () => {
    const fixtures: Array<[Parameters<typeof normalizeQualitasProviderOutcome>[0], string]> = [
      [{ status: 404, bodyText: "Póliza no encontrada" }, "POLICY_NOT_FOUND"],
      [{ status: 200, bodyText: "Póliza no elegible por vigencia" }, "POLICY_NOT_ELIGIBLE"],
      [{ status: 200, bodyText: "Correo inválido o no permitido" }, "EMAIL_REJECTED"],
      [{ status: 429, bodyText: "Demasiadas solicitudes" }, "RATE_LIMITED"],
      [{ status: 500, bodyText: "Servicio temporalmente no disponible" }, "QUALITAS_UNAVAILABLE"],
      [{ status: 200, bodyText: "Respuesta no reconocida" }, "QUALITAS_FLOW_CHANGED"],
    ];
    for (const [input, expected] of fixtures) {
      expect(normalizeQualitasProviderOutcome(input)).toBe(expected);
    }
  });

  it("classifies timeouts before and after final submission", async () => {
    const timeoutTransport: QualitasHttpTransport = vi.fn(async () => {
      throw new DOMException("timed out", "AbortError");
    });
    await expect(prepareQualitasPaymentLink(
      { policyNumber: "0000000000", recipientEmail: "agent@example.com" },
      { transport: timeoutTransport },
    )).resolves.toEqual({ outcome: "TIMEOUT" });

    const prepared: QualitasPreparedPaymentLink = {
      policyNumber: "0000000000",
      recipientEmail: "agent@example.com",
      transportReady: true,
      sessionCookie: "session=memory-only",
      finalActionUrl: finalAction,
      finalFields: { resumenWSUrl: resumeUrl },
      resumeWsUrl: resumeUrl,
      refererUrl: "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/pago-tdc",
    };
    await expect(requestQualitasPaymentLink(prepared, { transport: timeoutTransport })).resolves.toEqual({ outcome: "UNCERTAIN" });
  });

  it("rejects an oversized response before interpreting it", async () => {
    const transport: QualitasHttpTransport = vi.fn(async () => response(initialHtml));
    await expect(prepareQualitasPaymentLink(
      { policyNumber: "0000000000", recipientEmail: "agent@example.com" },
      { transport, maxResponseBytes: 8 },
    )).resolves.toEqual({ outcome: "UNEXPECTED_RESPONSE" });
  });
});
