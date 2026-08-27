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

export type QualitasRequestOptions = {
  transport?: QualitasHttpTransport;
  timeoutMs?: number;
  maxResponseBytes?: number;
};

const QUALITAS_HOST = "www.qualitas.com.mx";
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;
const MAX_REDIRECTS = 2;

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
}): Promise<SessionResponse> {
  let url = input.url;
  let init = { ...input.init };
  const transport = input.options.transport ?? fetch;
  const timeoutMs = input.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input.options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    if (!isAllowedQualitasUrl(url)) return { finalUrl: url, redirectedToUnexpectedHost: true };
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
        if (!location) return { response, finalUrl: url, bodyText: "" };
        const nextUrl = new URL(location, url).toString();
        if (!isAllowedQualitasUrl(nextUrl) || redirect === MAX_REDIRECTS) {
          return { response, finalUrl: nextUrl, redirectedToUnexpectedHost: !isAllowedQualitasUrl(nextUrl) };
        }
        const preserveBody = response.status === 307 || response.status === 308;
        init = preserveBody ? init : { ...init, method: "GET", body: undefined };
        url = nextUrl;
        continue;
      }
      const bodyText = await readBoundedResponseText(response, maxResponseBytes);
      return { response, bodyText, finalUrl: url };
    } catch (error) {
      if (error instanceof QualitasResponseTooLargeError) return { finalUrl: url, responseTooLarge: true };
      if (error instanceof DOMException && error.name === "AbortError") {
        return { finalUrl: url, timedOut: true };
      }
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

  const policyNumber = input.policyNumber.trim();
  const recipientEmail = input.recipientEmail.trim().toLowerCase();
  const cookieJar = new Map<string, string>();
  const initial = await requestWithSession({
    url: QUALITAS_PAYMENT_LINK_ENTRYPOINT,
    init: { method: "GET", headers: { Accept: "text/html" } },
    cookieJar,
    options,
    finalSubmission: false,
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
  });
  if (!policyResponse.bodyText) return resultForSessionResponse(policyResponse, false);

  const contactForm = findFormContaining(policyResponse.bodyText, "temail");
  if (!contactForm || formMethod(contactForm) !== "POST") return resultForSessionResponse(policyResponse, false);
  const finalActionUrl = formAction(contactForm, policyResponse.finalUrl);
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
    refererUrl: policyResponse.finalUrl,
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
  });
  return resultForSessionResponse(response, true);
}
