import "server-only";

export const QUALITAS_PAYMENT_LINK_ENTRYPOINT =
  "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/inicio";

export const QUALITAS_PAYMENT_LINK_OUTCOMES = [
  "SUCCESS",
  "POLICY_NOT_FOUND",
  "POLICY_NOT_ELIGIBLE",
  "EMAIL_REJECTED",
  "QUALITAS_UNAVAILABLE",
  "QUALITAS_FLOW_CHANGED",
  "RATE_LIMITED",
  "TIMEOUT",
  "UNCERTAIN",
  "UNEXPECTED_RESPONSE",
] as const;

export type QualitasPaymentLinkOutcome = (typeof QUALITAS_PAYMENT_LINK_OUTCOMES)[number];

export type QualitasPaymentLinkResult = {
  outcome: QualitasPaymentLinkOutcome;
  paymentUrl?: string;
};

export type QualitasPaymentLinkInput = {
  policyNumber: string;
  recipientEmail: string;
};

export type QualitasPreparedPaymentLink = {
  policyNumber: string;
  recipientEmail: string;
  transportReady: true;
  sessionCookie: string;
  finalActionUrl: string;
  finalFields: Record<string, string>;
  resumeWsUrl: string;
  refererUrl: string;
};

export type QualitasHttpTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type QualitasProviderEvent = {
  event: "qualitas.payment_link.provider";
  traceId: string;
  step: "entrypoint" | "policy_lookup" | "pagar_ahora" | "contact_form" | "final_submission";
  phase: "started" | "completed" | "redirect" | "timeout" | "network_error" | "response_too_large" | "flow_changed";
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  redirectCount?: number;
  finalSubmission?: boolean;
  bodyBytes?: number;
}

export type QualitasRequestOptions = {
  transport?: QualitasHttpTransport;
  timeoutMs?: number;
  finalTimeoutMs?: number;
  maxResponseBytes?: number;
  traceId?: string;
  onEvent?: (event: QualitasProviderEvent) => void;
};

const QUALITAS_HOST = "www.qualitas.com.mx";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_FINAL_SUBMISSION_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 2;

function safeQualitasPath(value: string) {
  try {
    return new URL(value).pathname;
  } catch {
    return "[invalid-url]";
  }
}

function emitQualitasProviderEvent(options: QualitasRequestOptions, event: Omit<QualitasProviderEvent, "event" | "traceId">) {
  const payload: QualitasProviderEvent = {
    event: "qualitas.payment_link.provider",
    traceId: options.traceId ?? "untracked",
    ...event,
  };
  options.onEvent?.(payload);
  if (typeof console !== "undefined") console.info(`[${payload.event}]`, JSON.stringify(payload));
}

const QUALITAS_INSURER_NAMES = new Set([
  "qualitas",
  "qualitas compania de seguros",
  "qualitas compania de seguros sa de cv",
  "qualitas compania de seguros s a de c v",
  "qualitas mexico",
  "qualitas mx",
]);

export function normalizeQualitasInsurerName(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isQualitasInsurerName(value: string | null | undefined) {
  return QUALITAS_INSURER_NAMES.has(normalizeQualitasInsurerName(value));
}

export function isValidQualitasEmail(value: string | null | undefined): value is string {
  const normalized = value?.trim() ?? "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(normalized);
}

export function normalizeQualitasEmail(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return isValidQualitasEmail(normalized) ? normalized : null;
}

export function normalizeQualitasPolicyNumber(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  if (!/^\d{1,10}$/.test(normalized)) return null;
  return normalized.padStart(10, "0");
}

export function maskQualitasEmail(value: string) {
  const [localPart, domain] = value.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart.slice(0, 1)}***@${domain}`;
}

export function normalizeQualitasProviderOutcome(input: {
  status?: number;
  bodyText?: string | null;
  finalSubmission?: boolean;
  timedOut?: boolean;
  redirectedToUnexpectedHost?: boolean;
}): QualitasPaymentLinkOutcome {
  if (input.timedOut) return input.finalSubmission ? "UNCERTAIN" : "TIMEOUT";
  if (input.redirectedToUnexpectedHost) return "QUALITAS_FLOW_CHANGED";

  const text = input.bodyText?.toLowerCase() ?? "";
  if (/c[oó]digo\s*:\s*0\b/.test(text)) return "SUCCESS";
  if (/99991|otro link de pago en curso/.test(text)) return "UNCERTAIN";
  if (input.status === 429 || /too many|rate limit|demasiadas solicitudes/.test(text)) return "RATE_LIMITED";
  if (input.status !== undefined && input.status >= 500) return "QUALITAS_UNAVAILABLE";
  if (/no se encontr|no encontr|no existe|p[oó]liza .*inv[aá]lida|not found/.test(text)) return "POLICY_NOT_FOUND";
  if (/no puede|no es posible|no elegible|vigencia|flotilla|endoso|not eligible/.test(text)) return "POLICY_NOT_ELIGIBLE";
  if (/correo|email|e-mail/.test(text) && /rechaz|inv[aá]lid|no permitido|not valid|rejected/.test(text)) return "EMAIL_REJECTED";
  return input.status !== undefined && input.status >= 400 ? "UNEXPECTED_RESPONSE" : "QUALITAS_FLOW_CHANGED";
}

export function isQualitasPaymentLinkEnabled() {
  return process.env.QUALITAS_PAYMENT_LINK_ENABLED?.trim() === "true";
}

function isAllowedQualitasUrl(value: string | URL) {
  try {
    const url = new URL(value.toString());
    return url.protocol === "https:" && url.hostname === QUALITAS_HOST;
  } catch {
    return false;
  }
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function getAttribute(source: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`\\b${escapedName}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : null;
}

function getForms(html: string) {
  return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((match) => match[0]);
}

function collectFormFields(form: string) {
  const fields = new Map<string, string>();
  for (const match of form.matchAll(/<input\b([^>]*)>/gi)) {
    const attributes = match[1];
    const name = getAttribute(attributes, "name");
    const type = (getAttribute(attributes, "type") ?? "text").toLowerCase();
    if (!name || ["button", "file", "image", "reset", "submit"].includes(type)) continue;
    fields.set(name, getAttribute(attributes, "value") ?? "");
  }
  return fields;
}

function findFormContaining(html: string, fieldName: string) {
  return getForms(html).find((form) => collectFormFields(form).has(fieldName)) ?? null;
}

function visibleHtmlText(value: string) {
  return value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function findPagarAhoraRequest(html: string, baseUrl: string) {
  const pagarForm = getForms(html).find((form) => /pagar\s+ahora/i.test(visibleHtmlText(form)));
  if (pagarForm) {
    const action = formAction(pagarForm, baseUrl);
    if (!action || !isAllowedQualitasUrl(action)) return null;
    const fields = Object.fromEntries(collectFormFields(pagarForm));
    for (const match of pagarForm.matchAll(/<input\b([^>]*)>/gi)) {
      const attributes = match[1];
      const name = getAttribute(attributes, "name");
      const type = (getAttribute(attributes, "type") ?? "text").toLowerCase();
      const value = getAttribute(attributes, "value") ?? "";
      if (name && type === "submit" && /pagar\s+ahora/i.test(value)) fields[name] = value;
    }
    return { method: formMethod(pagarForm), url: action, fields };
  }

  const pagarLink = [...html.matchAll(/<a\b([^>]*)>[\s\S]*?<\/a>/gi)].find((match) => /pagar\s+ahora/i.test(visibleHtmlText(match[0])));
  if (pagarLink) {
    const href = getAttribute(pagarLink[1], "href");
    if (!href) return null;
    try {
      const url = new URL(href, baseUrl).toString();
      return isAllowedQualitasUrl(url) ? { method: "GET", url, fields: {} } : null;
    } catch {
      return null;
    }
  }

  // The live Quálitas page renders Pagar ahora as a JavaScript button rather than a form/link.
  // The observed destination is a same-host GET and does not perform a payment.
  if (/pagar\s+ahora/i.test(visibleHtmlText(html))) {
    const url = new URL("/web/qmx/pago-de-poliza/-/user-pago/pago-tdc", baseUrl).toString();
    return { method: "GET", url, fields: {} };
  }
  return null;
}

function formAction(form: string, baseUrl: string) {
  const action = getAttribute(form.match(/<form\b([^>]*)>/i)?.[1] ?? "", "action") ?? baseUrl;
  try {
    return new URL(action, baseUrl).toString();
  } catch {
    return null;
  }
}

function formMethod(form: string) {
  return (getAttribute(form.match(/<form\b([^>]*)>/i)?.[1] ?? "", "method") ?? "get").toUpperCase();
}

function cookieHeader(cookieJar: Map<string, string>) {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function updateCookieJar(response: Response, cookieJar: Map<string, string>) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [];
  const fallback = setCookies.length > 0 ? setCookies : (headers.get("set-cookie")?.match(/(?:^|,\s*)([^=;,]+=[^;,]*)/g) ?? []);
  for (const rawCookie of fallback) {
    const pair = rawCookie.replace(/^,\s*/, "").split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    cookieJar.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

class QualitasResponseTooLargeError extends Error {
  constructor() {
    super("QUALITAS_RESPONSE_TOO_LARGE");
    this.name = "QualitasResponseTooLargeError";
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number) {
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new QualitasResponseTooLargeError();
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new QualitasResponseTooLargeError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

type SessionResponse = {
  response?: Response;
  bodyText?: string;
  finalUrl: string;
  timedOut?: boolean;
  networkError?: boolean;
  responseTooLarge?: boolean;
  redirectedToUnexpectedHost?: boolean;
};

async function requestWithSession(input: {
  url: string;
  init: RequestInit;
  cookieJar: Map<string, string>;
  options: QualitasRequestOptions;
  finalSubmission: boolean;
  step: QualitasProviderEvent["step"];
}): Promise<SessionResponse> {
  let url = input.url;
  let init = { ...input.init };
  const transport = input.options.transport ?? fetch;
  const timeoutMs = input.finalSubmission
    ? input.options.finalTimeoutMs ?? DEFAULT_FINAL_SUBMISSION_TIMEOUT_MS
    : input.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const startedAt = Date.now();
    const method = (init.method ?? "GET").toUpperCase();
    if (!isAllowedQualitasUrl(url)) {
      emitQualitasProviderEvent(input.options, {
        step: input.step,
        phase: "flow_changed",
        method,
        path: safeQualitasPath(url),
        durationMs: Date.now() - startedAt,
        redirectCount: redirect,
        finalSubmission: input.finalSubmission,
      });
      return { finalUrl: url, redirectedToUnexpectedHost: true };
    }
    emitQualitasProviderEvent(input.options, {
      step: input.step,
      phase: "started",
      method,
      path: safeQualitasPath(url),
      redirectCount: redirect,
      finalSubmission: input.finalSubmission,
    });
    const headers = new Headers(init.headers);
    const cookies = cookieHeader(input.cookieJar);
    if (cookies) headers.set("Cookie", cookies);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await transport(url, { ...init, headers, redirect: "manual", signal: controller.signal });
      updateCookieJar(response, input.cookieJar);
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          emitQualitasProviderEvent(input.options, {
            step: input.step,
            phase: "flow_changed",
            method,
            path: safeQualitasPath(url),
            status: response.status,
            durationMs: Date.now() - startedAt,
            redirectCount: redirect,
            finalSubmission: input.finalSubmission,
          });
          return { response, finalUrl: url, bodyText: "" };
        }
        const nextUrl = new URL(location, url).toString();
        if (!isAllowedQualitasUrl(nextUrl) || redirect === MAX_REDIRECTS) {
          emitQualitasProviderEvent(input.options, {
            step: input.step,
            phase: "flow_changed",
            method,
            path: safeQualitasPath(nextUrl),
            status: response.status,
            durationMs: Date.now() - startedAt,
            redirectCount: redirect + 1,
            finalSubmission: input.finalSubmission,
          });
          return { response, finalUrl: nextUrl, redirectedToUnexpectedHost: !isAllowedQualitasUrl(nextUrl) };
        }
        emitQualitasProviderEvent(input.options, {
          step: input.step,
          phase: "redirect",
          method,
          path: safeQualitasPath(nextUrl),
          status: response.status,
          durationMs: Date.now() - startedAt,
          redirectCount: redirect + 1,
          finalSubmission: input.finalSubmission,
        });
        const preserveBody = response.status === 307 || response.status === 308;
        init = preserveBody ? init : { ...init, method: "GET", body: undefined };
        url = nextUrl;
        continue;
      }
      const bodyText = await readBoundedResponseText(response, maxResponseBytes);
      emitQualitasProviderEvent(input.options, {
        step: input.step,
        phase: "completed",
        method,
        path: safeQualitasPath(url),
        status: response.status,
        durationMs: Date.now() - startedAt,
        redirectCount: redirect,
        finalSubmission: input.finalSubmission,
        bodyBytes: new TextEncoder().encode(bodyText).byteLength,
      });
      return { response, bodyText, finalUrl: url };
    } catch (error) {
      if (error instanceof QualitasResponseTooLargeError) {
        emitQualitasProviderEvent(input.options, {
          step: input.step,
          phase: "response_too_large",
          method,
          path: safeQualitasPath(url),
          durationMs: Date.now() - startedAt,
          redirectCount: redirect,
          finalSubmission: input.finalSubmission,
        });
        return { finalUrl: url, responseTooLarge: true };
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        emitQualitasProviderEvent(input.options, {
          step: input.step,
          phase: "timeout",
          method,
          path: safeQualitasPath(url),
          durationMs: Date.now() - startedAt,
          redirectCount: redirect,
          finalSubmission: input.finalSubmission,
        });
        return { finalUrl: url, timedOut: true };
      }
      emitQualitasProviderEvent(input.options, {
        step: input.step,
        phase: "network_error",
        method,
        path: safeQualitasPath(url),
        durationMs: Date.now() - startedAt,
        redirectCount: redirect,
        finalSubmission: input.finalSubmission,
      });
      return { finalUrl: url, networkError: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return { finalUrl: url, redirectedToUnexpectedHost: true };
}

function resultForSessionResponse(result: SessionResponse, finalSubmission: boolean): QualitasPaymentLinkResult {
  if (result.responseTooLarge) return { outcome: "UNEXPECTED_RESPONSE" };
  if (result.networkError) return { outcome: "QUALITAS_UNAVAILABLE" };
  return {
    outcome: normalizeQualitasProviderOutcome({
      status: result.response?.status,
      bodyText: result.bodyText,
      finalSubmission,
      timedOut: result.timedOut,
      redirectedToUnexpectedHost: result.redirectedToUnexpectedHost,
    }),
  };
}

export async function prepareQualitasPaymentLink(
  input: QualitasPaymentLinkInput,
  options: QualitasRequestOptions = {},
): Promise<QualitasPreparedPaymentLink | QualitasPaymentLinkResult> {
  if (!input.policyNumber.trim() || !isValidQualitasEmail(input.recipientEmail)) {
    return { outcome: "UNEXPECTED_RESPONSE" };
  }

  const policyNumber = normalizeQualitasPolicyNumber(input.policyNumber);
  if (!policyNumber) return { outcome: "UNEXPECTED_RESPONSE" };
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  const cookieJar = new Map<string, string>();
  const initial = await requestWithSession({
    url: QUALITAS_PAYMENT_LINK_ENTRYPOINT,
    init: { method: "GET", headers: { Accept: "text/html" } },
    cookieJar,
    options,
    finalSubmission: false,
    step: "entrypoint",
  });
  if (!initial.bodyText) return resultForSessionResponse(initial, false);

  const policyForm = findFormContaining(initial.bodyText, "numPoliza");
  if (!policyForm || formMethod(policyForm) !== "POST") return { outcome: "QUALITAS_FLOW_CHANGED" };
  const policyAction = formAction(policyForm, initial.finalUrl);
  if (!policyAction || !isAllowedQualitasUrl(policyAction)) return { outcome: "QUALITAS_FLOW_CHANGED" };
  const policyFields = collectFormFields(policyForm);
  policyFields.set("numPoliza", policyNumber);
  const policyBody = new URLSearchParams(Object.fromEntries(policyFields));
  const policyResponse = await requestWithSession({
    url: policyAction,
    init: {
      method: "POST",
      headers: {
        Accept: "text/html",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        Origin: new URL(policyAction).origin,
        Referer: initial.finalUrl,
      },
      body: policyBody,
    },
    cookieJar,
    options,
    finalSubmission: false,
    step: "policy_lookup",
  });
  if (!policyResponse.bodyText) return resultForSessionResponse(policyResponse, false);

  const policyHtml = policyResponse.bodyText;
  let contactPage = policyResponse;
  const contactFormStartedAt = Date.now();
  let contactForm = findFormContaining(policyHtml, "temail");
  if (!contactForm) {
    const pagarAhora = findPagarAhoraRequest(policyHtml, policyResponse.finalUrl);
    if (!pagarAhora || !["GET", "POST"].includes(pagarAhora.method)) {
      emitQualitasProviderEvent(options, {
        step: "pagar_ahora",
        phase: "flow_changed",
        path: safeQualitasPath(policyResponse.finalUrl),
        finalSubmission: false,
        durationMs: Date.now() - contactFormStartedAt,
      });
      return resultForSessionResponse(policyResponse, false);
    }
    const pagarResponse = await requestWithSession({
      url: pagarAhora.url,
      init: pagarAhora.method === "GET"
        ? {
            method: "GET",
            headers: { Accept: "text/html", Referer: policyResponse.finalUrl },
          }
        : {
            method: "POST",
            headers: {
              Accept: "text/html",
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              Origin: new URL(pagarAhora.url).origin,
              Referer: policyResponse.finalUrl,
            },
            body: new URLSearchParams(pagarAhora.fields),
          },
      cookieJar,
      options,
      finalSubmission: false,
      step: "pagar_ahora",
    });
    const pagarHtml = pagarResponse.bodyText;
    if (!pagarHtml) return resultForSessionResponse(pagarResponse, false);
    contactPage = pagarResponse;
    contactForm = findFormContaining(pagarHtml, "temail");
  }
  if (!contactForm || formMethod(contactForm) !== "POST") {
    emitQualitasProviderEvent(options, {
      step: "contact_form",
      phase: "flow_changed",
      path: safeQualitasPath(contactPage.finalUrl),
      status: contactPage.response?.status,
      durationMs: Date.now() - contactFormStartedAt,
      finalSubmission: false,
    });
    return resultForSessionResponse(contactPage, false);
  }
  emitQualitasProviderEvent(options, {
    step: "contact_form",
    phase: "completed",
    method: formMethod(contactForm),
    path: safeQualitasPath(contactPage.finalUrl),
    status: contactPage.response?.status,
    durationMs: Date.now() - contactFormStartedAt,
    finalSubmission: false,
  });
  const finalActionUrl = formAction(contactForm, contactPage.finalUrl);
  const finalFields = Object.fromEntries(collectFormFields(contactForm));
  const resumeWsUrl = finalFields.resumenWSUrl ?? "";
  if (!finalActionUrl || !isAllowedQualitasUrl(finalActionUrl) || !resumeWsUrl || !isAllowedQualitasUrl(resumeWsUrl)) {
    return { outcome: "QUALITAS_FLOW_CHANGED" };
  }

  return {
    policyNumber,
    recipientEmail,
    transportReady: true,
    sessionCookie: cookieHeader(cookieJar),
    finalActionUrl,
    finalFields,
    resumeWsUrl,
    refererUrl: contactPage.finalUrl,
  };
}

export async function requestQualitasPaymentLink(
  prepared: QualitasPreparedPaymentLink,
  options: QualitasRequestOptions = {},
): Promise<QualitasPaymentLinkResult> {
  if (!prepared.transportReady || !isAllowedQualitasUrl(prepared.finalActionUrl) || !isAllowedQualitasUrl(prepared.resumeWsUrl)) {
    return { outcome: "QUALITAS_FLOW_CHANGED" };
  }
  const cookieJar = new Map<string, string>();
  for (const pair of prepared.sessionCookie.split(/;\s*/)) {
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const fields = new FormData();
  for (const [name, value] of Object.entries(prepared.finalFields)) fields.set(name, value);
  fields.set("numTelefono", "");
  fields.set("temail", prepared.recipientEmail);
  fields.set("resumenWSUrl", prepared.resumeWsUrl);

  const response = await requestWithSession({
    url: prepared.finalActionUrl,
    init: {
      method: "POST",
      headers: {
        Accept: "*/*",
        Origin: new URL(prepared.finalActionUrl).origin,
        Referer: prepared.refererUrl,
        "X-Pjax": "true",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: fields,
    },
    cookieJar,
    options,
    finalSubmission: true,
    step: "final_submission",
  });
  return resultForSessionResponse(response, true);
}
