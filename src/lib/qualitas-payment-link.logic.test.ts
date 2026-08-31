import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  QUALITAS_PAYMENT_LINK_ENTRYPOINT,
  normalizeQualitasPolicyNumber,
  normalizeQualitasProviderOutcome,
  buildQualitasDeliveryFields,
  qualitasRequestShapeSignature,
  prepareQualitasPaymentLink,
  requestQualitasPaymentLink,
  type QualitasHttpTransport,
  type QualitasFormField,
  type QualitasPreparedPaymentLink,
} from "./qualitas-payment-link";
import {
  QUALITAS_FINAL_RESPONSE_FIXTURES,
  QUALITAS_NATIVE_REQUEST_FIXTURES,
} from "./qualitas-native-fixtures";

const policyAction = "https://www.qualitas.com.mx/web/qmx/pago-de-poliza?p_p_id=pagopoliza_WAR_PagoPolizaportlet&p_p_lifecycle=1&p_p_state=normal&p_p_mode=view&_pagopoliza_WAR_PagoPolizaportlet_myaction=consulta-datos&p_auth=redacted";
const paymentPageUrl = "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/pago-tdc";
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
  <input type="radio" name="tipo" value="" checked>
  <input type="radio" name="tipo" value="3">
  <input type="hidden" name="disabledDynamicField" value="must-not-send" disabled>
  <input name="temail" value="">
</form>`;

const paymentPageHtml = `<button type="button">Pagar ahora</button>`;

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
    { policyNumber: "0000000000", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
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
      { policyNumber: "940454748", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
      { transport },
    );

    expect(prepared).toMatchObject({ transportReady: true, request: { policyNumber: "0940454748" } });
    expect((calls[1].init?.body as URLSearchParams).get("numPoliza")).toBe("0940454748");
  });

  it("discovers the session flow and sends the final urlencoded request", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml, 200, { "set-cookie": "JSESSIONID=session-only; Path=/" }),
      response(contactHtml, 200, { "set-cookie": "route=route-only; Path=/" }),
      response("Código: 0 Mensaje: Se genero link de pago y se envio al correo indicado."),
    ]);

    const prepared = await prepareForFinal(transport);
    const result = await requestQualitasPaymentLink(prepared, { transport });

    expect(result).toEqual({ outcome: "SUCCESS", reason: "SUCCESS_CODE_0" });
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe(QUALITAS_PAYMENT_LINK_ENTRYPOINT);
    expect(new URL(calls[1].url).searchParams.get("_pagopoliza_WAR_PagoPolizaportlet_myaction")).toBe("consulta-datos");
    expect(new URL(calls[2].url).searchParams.get("_pagopoliza_WAR_PagoPolizaportlet_myaction")).toBe("envia-link-pago");

    const policyBody = calls[1].init?.body as URLSearchParams;
    expect(policyBody.get("numPoliza")).toBe("0000000000");
    expect(policyBody.get("dynamicField")).toBe("dynamicValue");

    const finalBody = calls[2].init?.body as URLSearchParams;
    expect(finalBody).toBeInstanceOf(URLSearchParams);
    expect(finalBody.get("tipo")).toBe("1");
    expect(finalBody.get("numTelefono")).toBe("");
    expect(finalBody.get("temail")).toBe("agent@example.com");
    expect(finalBody.get("resumenWSUrl")).toBe(resumeUrl);
    expect(finalBody.has("tipo")).toBe(true);
    expect(finalBody.has("disabledDynamicField")).toBe(false);
    expect((calls[2].init?.headers as Headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
    expect((calls[2].init?.headers as Headers).has("X-Pjax")).toBe(false);
    expect((calls[2].init?.headers as Headers).has("X-Requested-With")).toBe(false);
    expect((calls[2].init?.headers as Headers).has("Cookie")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("agent@example.com");
  });

  it("marks final submission immediately before the single final POST", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response("Código: 0 Mensaje: Se genero link de pago."),
    ]);
    const started = vi.fn();
    const prepared = await prepareForFinal(transport);
    const result = await requestQualitasPaymentLink(prepared, { transport, onFinalSubmissionStarted: started });

    expect(result.outcome).toBe("SUCCESS");
    expect(started).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(3);
  });

  it("does not send the final POST if the durable STARTED claim fails", async () => {
    const { transport, calls } = sequenceTransport([response(initialHtml), response(contactHtml)]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, {
      transport,
      onFinalSubmissionStarted: () => { throw new Error("START_CLAIM_FAILED"); },
    })).rejects.toThrow("START_CLAIM_FAILED");
    expect(calls).toHaveLength(2);
  });

  it("does not classify a generic no puede phrase as policy eligibility", () => {
    expect(normalizeQualitasProviderOutcome({
      status: 200,
      bodyText: "El portal no puede continuar con la solicitud.",
      finalSubmission: true,
    })).toBe("UNCERTAIN_POST_SUBMISSION");
  });

  it("requires the final Código/Mensaje acuse before classifying eligibility", () => {
    expect(normalizeQualitasProviderOutcome({
      status: 200,
      bodyText: "Póliza no puede usar este flujo. Portal de pago.",
      finalSubmission: true,
    })).toBe("UNCERTAIN_POST_SUBMISSION");
    expect(normalizeQualitasProviderOutcome({
      status: 200,
      bodyText: "Código: 1 Mensaje: La póliza no puede usar este flujo de pago.",
      finalSubmission: true,
    })).toBe("POLICY_NOT_ELIGIBLE");
  });

  it("sends WhatsApp with Quálitas' explicit channel value and normalized phone", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response("Código: 0 Mensaje: Se genero link de pago y se envio por WhatsApp."),
    ]);
    const prepared = await prepareQualitasPaymentLink({
      policyNumber: "0000000000",
      deliveryChannel: "WHATSAPP",
      destination: "+52 55 1234 5678",
      correlationId: "test-correlation",
    }, { transport });

    expect(prepared).toMatchObject({ transportReady: true, request: { deliveryChannel: "WHATSAPP", destination: "5512345678" } });
    await expect(requestQualitasPaymentLink(prepared as QualitasPreparedPaymentLink, { transport })).resolves.toEqual({
      outcome: "SUCCESS",
      reason: "SUCCESS_CODE_0",
    });
    const finalBody = calls[2].init?.body as URLSearchParams;
    expect(finalBody).toBeInstanceOf(URLSearchParams);
    expect(finalBody.get("tipo")).toBe("3");
    expect(finalBody.get("numTelefono")).toBe("5512345678");
    expect(finalBody.get("temail")).toBe("");
    expect(finalBody.has("disabledDynamicField")).toBe(false);
  });

  it("advances through Pagar ahora before discovering the contact form", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(paymentPageHtml),
      response(contactHtml),
    ]);

    const prepared = await prepareForFinal(transport);

    expect(calls).toHaveLength(3);
    expect(calls[1].url).toBe(policyAction);
    expect(calls[2].url).toBe(paymentPageUrl);
    expect(calls[2].init?.method).toBe("GET");
    expect(prepared).toMatchObject({ transportReady: true, refererUrl: paymentPageUrl });
  });

  it("collects select, textarea, duplicate fields, and the selected Pagar ahora submitter", async () => {
    const paymentFormHtml = `<form method="post" action="${paymentPageUrl}">
      <input type="hidden" name="dynamic" value="one">
      <input type="hidden" name="dynamic" value="two">
      <select name="channel"><option value="email">Email</option><option value="whatsapp" selected>WhatsApp</option></select>
      <textarea name="note">native text</textarea>
      <button type="submit" name="ignore" value="other">Otra acción</button>
      <button type="submit" name="pagar" value="Pagar ahora">Pagar ahora</button>
    </form>`;
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(paymentFormHtml),
      response(contactHtml),
    ]);

    const prepared = await prepareForFinal(transport);

    expect(calls[2].init?.method).toBe("POST");
    const paymentBody = calls[2].init?.body as URLSearchParams;
    expect([...paymentBody.entries()]).toEqual([
      ["dynamic", "one"],
      ["dynamic", "two"],
      ["channel", "whatsapp"],
      ["note", "native text"],
      ["pagar", "Pagar ahora"],
    ]);
    expect(prepared).toMatchObject({ transportReady: true });
  });

  it("emits a redacted trace for every provider stage", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(paymentPageHtml),
      response(contactHtml),
      response("Código: 0 Mensaje: Se genero link de pago y se envio al correo indicado."),
    ]);
    const events: Array<Record<string, unknown>> = [];
    const options = {
      transport,
      traceId: "draft-redacted",
      onEvent: (event: Record<string, unknown>) => events.push(event),
    };

    const prepared = await prepareQualitasPaymentLink(
      { policyNumber: "0000000000", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
      options,
    );
    expect(prepared).toMatchObject({ transportReady: true });
    await requestQualitasPaymentLink(prepared as QualitasPreparedPaymentLink, options);

    expect(events.filter((event) => event.phase === "started").map((event) => event.step)).toEqual([
      "entrypoint",
      "policy_lookup",
      "pagar_ahora",
      "final_submission",
    ]);
    expect(events.some((event) => event.step === "contact_form" && event.phase === "completed")).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({
      step: "final_submission",
      phase: "classified",
      outcome: "SUCCESS",
      reason: "SUCCESS_CODE_0",
      hasSuccessCode: true,
      hasDuplicateCode: false,
      hasVisibleContactForm: false,
      hasVisibleResumeMarker: false,
      duplicateEvidence: "NONE",
      deliveryMethod: "EMAIL",
      requestVariant: "EMAIL_NATIVE_FORM",
      hasTipoField: true,
      hasEmailField: true,
      hasPhoneField: true,
      requestEncoding: "FORM_URLENCODED",
    }));
    expect(events.every((event) => event.traceId === "draft-redacted")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("agent@example.com");
    expect(JSON.stringify(events)).not.toContain("dynamicValue");
  });

  it("maps the provider duplicate response to ALREADY_IN_PROGRESS without retrying", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response("Codigo: 99991 Mensaje: Error: Ya se encuentra otro link de pago en curso."),
    ]);
    const prepared = await prepareForFinal(transport);

    const result = await requestQualitasPaymentLink(prepared, { transport });

    expect(result).toEqual({ outcome: "ALREADY_IN_PROGRESS", reason: "DUPLICATE_LINK_99991" });
    expect(calls).toHaveLength(3);
  });

  it("does not classify a duplicate code while the visible contact form remains", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<main>Código: 99991</main><form><input name="temail"><input type="hidden" name="resumenWSUrl" value="${resumeUrl}"></form>`, 200, {
        "content-type": "text/html",
      }),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "UNCERTAIN_POST_SUBMISSION",
      reason: "FINAL_RESPONSE_UNRECOGNIZED",
    });
    expect(calls).toHaveLength(3);
  });

  it("classifies a duplicate code in visible HTML without a contact form", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response("<main>Código: 99991 Mensaje: Ya se encuentra otro link de pago en curso.</main>", 200, { "content-type": "text/html" }),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "ALREADY_IN_PROGRESS",
      reason: "DUPLICATE_LINK_99991",
    });
  });

  it("classifies Quálitas' visible in-process message even when the form remains in the HTML", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<main>Código: 99991<br>Mensaje: Error: Generacion de Link de pago para la póliza en proceso</main><form><input name="temail"></form>`, 200, {
        "content-type": "text/html",
      }),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "ALREADY_IN_PROGRESS",
      reason: "DUPLICATE_LINK_99991",
    });
  });

  it("classifies a duplicate code in JSON", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(JSON.stringify({ codigo: 99991, mensaje: "Ya existe otra liga de pago en curso" }), 200, {
        "content-type": "application/json",
      }),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "ALREADY_IN_PROGRESS",
      reason: "DUPLICATE_LINK_99991",
    });
  });

  it("does not treat duplicate text inside scripts as a duplicate response", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<script>const legacyCode = "99991";</script><main>Código: 0 Mensaje: Se genero link de pago y se envio al correo indicado.</main>`),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({ outcome: "SUCCESS", reason: "SUCCESS_CODE_0" });
    expect(calls).toHaveLength(3);
  });

  it("recognizes an HTML-encoded success code before hidden duplicate text", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<main>C&#243;digo: 0 Mensaje: Se genero link de pago.</main><div hidden>99991</div>`),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({ outcome: "SUCCESS", reason: "SUCCESS_CODE_0" });
    expect(calls).toHaveLength(3);
  });

  it("recognizes a named-entity success code before hidden duplicate text", async () => {
    const { transport, calls } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<main>C&oacute;digo&nbsp;: 0 Mensaje: Se genero link de pago.</main><div hidden>99991</div>`),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({ outcome: "SUCCESS", reason: "SUCCESS_CODE_0" });
    expect(calls).toHaveLength(3);
  });

  it("recognizes the real visible success acuse without a Mensaje label", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(QUALITAS_FINAL_RESPONSE_FIXTURES.EMAIL_SUCCESS_WITHOUT_MESSAGE_LABEL),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "SUCCESS",
      reason: "SUCCESS_CODE_0",
    });
  });

  it("does not classify a success code that exists only in a script", () => {
    expect(normalizeQualitasProviderOutcome({
      status: 200,
      contentType: "text/html",
      bodyText: QUALITAS_FINAL_RESPONSE_FIXTURES.HIDDEN_SUCCESS_CODE,
      finalSubmission: true,
    })).toBe("UNCERTAIN_POST_SUBMISSION");
  });

  it("ignores a duplicate marker inside hidden HTML when no visible acuse exists", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<main>Solicitud recibida</main><div hidden>Código: 99991 Ya se encuentra otro link de pago en curso.</div>`),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "UNCERTAIN_POST_SUBMISSION",
      reason: "FINAL_RESPONSE_UNRECOGNIZED",
    });
  });

  it("recognizes a JSON success acuse", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(JSON.stringify({ codigo: 0, mensaje: "Se genero link de pago y se envio al correo indicado." }), 200, {
        "content-type": "application/json",
      }),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "SUCCESS",
      reason: "SUCCESS_CODE_0",
    });
  });

  it("classifies a generic final HTTP 200 as submitted but unverified", async () => {
    const { transport } = sequenceTransport([
      response(initialHtml),
      response(contactHtml),
      response(`<main>Portal de pago</main>`),
    ]);
    const prepared = await prepareForFinal(transport);

    await expect(requestQualitasPaymentLink(prepared, { transport })).resolves.toEqual({
      outcome: "UNCERTAIN_POST_SUBMISSION",
      reason: "FINAL_RESPONSE_UNRECOGNIZED",
    });
  });

  it("fails closed on a cross-host redirect", async () => {
    const transport: QualitasHttpTransport = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: "https://evil.example/payment" } }),
    );

    await expect(prepareQualitasPaymentLink(
      { policyNumber: "0000000000", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
      { transport },
    )).resolves.toEqual({ outcome: "PROVIDER_FLOW_CHANGED", reason: "FLOW_CHANGED" });
  });

  it("maps representative redacted provider fixtures", () => {
    const fixtures: Array<[Parameters<typeof normalizeQualitasProviderOutcome>[0], string]> = [
      [{ status: 404, bodyText: "Póliza no encontrada" }, "POLICY_NOT_FOUND"],
      [{ status: 200, bodyText: "Póliza no elegible por vigencia" }, "POLICY_NOT_ELIGIBLE"],
      [{ status: 200, bodyText: "Correo inválido o no permitido" }, "DESTINATION_REJECTED"],
      [{ status: 429, bodyText: "Demasiadas solicitudes" }, "PROVIDER_UNAVAILABLE"],
      [{ status: 500, bodyText: "Servicio temporalmente no disponible" }, "PROVIDER_UNAVAILABLE"],
      [{ status: 200, bodyText: "Respuesta no reconocida" }, "PROVIDER_FLOW_CHANGED"],
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
      { policyNumber: "0000000000", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
      { transport: timeoutTransport },
    )).resolves.toEqual({ outcome: "TIMEOUT_PRE_SUBMISSION", reason: "TIMEOUT_BEFORE_SUBMISSION" });

    const prepared: QualitasPreparedPaymentLink = {
      request: { policyNumber: "0000000000", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
      transportReady: true,
      sessionCookie: "session=memory-only",
      finalActionUrl: finalAction,
      finalFields: [{ name: "resumenWSUrl", value: resumeUrl, controlType: "input" }],
      resumeWsUrl: resumeUrl,
      refererUrl: "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/pago-tdc",
    };
    await expect(requestQualitasPaymentLink(prepared, { transport: timeoutTransport })).resolves.toEqual({
      outcome: "UNCERTAIN_POST_SUBMISSION",
      reason: "FINAL_TIMEOUT",
    });
  });

  it("rejects an oversized response before interpreting it", async () => {
    const transport: QualitasHttpTransport = vi.fn(async () => response(initialHtml));
    await expect(prepareQualitasPaymentLink(
      { policyNumber: "0000000000", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" },
      { transport, maxResponseBytes: 8 },
    )).resolves.toEqual({ outcome: "UNEXPECTED_RESPONSE", reason: "RESPONSE_TOO_LARGE" });
  });

  it("preserves ordered duplicate controls and applies channel-specific fields", () => {
    const fields: QualitasFormField[] = [
      { name: "dynamic", value: "one", controlType: "input" },
      { name: "dynamic", value: "two", controlType: "input" },
      { name: "tipo", value: "", controlType: "input" },
      { name: "numTelefono", value: "old-phone", controlType: "input" },
      { name: "temail", value: "old@example.com", controlType: "input" },
      { name: "resumenWSUrl", value: resumeUrl, controlType: "input" },
    ];

    const email = buildQualitasDeliveryFields({
      fields,
      deliveryChannel: "EMAIL",
      destination: "agent@example.com",
      resumeWsUrl: resumeUrl,
    });
    expect(email.map((field) => field.name)).toEqual([
      "numTelefono", "temail", "tipo", "resumenWSUrl", "dynamic", "dynamic",
    ]);
    expect(email.find((field) => field.name === "temail")?.value).toBe("agent@example.com");
    expect(email.find((field) => field.name === "numTelefono")?.value).toBe("");
    expect(email.find((field) => field.name === "tipo")?.value).toBe("1");

    const whatsapp = buildQualitasDeliveryFields({
      fields,
      deliveryChannel: "WHATSAPP",
      destination: "5512345678",
      resumeWsUrl: resumeUrl,
    });
    expect(whatsapp.map((field) => field.name)).toEqual([
      "numTelefono", "temail", "tipo", "resumenWSUrl", "dynamic", "dynamic",
    ]);
    expect(whatsapp.find((field) => field.name === "tipo")?.value).toBe("3");
    expect(qualitasRequestShapeSignature(email, "EMAIL")).not.toBe(qualitasRequestShapeSignature(whatsapp, "WHATSAPP"));
  });

  it("matches the redacted native signatures for Email and WhatsApp", () => {
    expect(qualitasRequestShapeSignature(QUALITAS_NATIVE_REQUEST_FIXTURES.EMAIL.fields, "EMAIL"))
      .toBe(QUALITAS_NATIVE_REQUEST_FIXTURES.EMAIL.signature);
    expect(qualitasRequestShapeSignature(QUALITAS_NATIVE_REQUEST_FIXTURES.WHATSAPP.fields, "WHATSAPP"))
      .toBe(QUALITAS_NATIVE_REQUEST_FIXTURES.WHATSAPP.signature);
  });
});
