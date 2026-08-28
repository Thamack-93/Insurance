import "server-only";
import { parse, type DefaultTreeAdapterTypes } from "parse5";

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

export const QUALITAS_PAYMENT_LINK_REASONS = [
  "SUCCESS_CODE_0",
  "DUPLICATE_LINK_99991",
  "FINAL_RESPONSE_UNRECOGNIZED",
  "FINAL_TIMEOUT",
  "FLOW_CHANGED",
  "POLICY_NOT_FOUND",
  "POLICY_NOT_ELIGIBLE",
  "EMAIL_REJECTED",
  "QUALITAS_UNAVAILABLE",
  "RATE_LIMITED",
  "TIMEOUT_BEFORE_SUBMISSION",
  "RESPONSE_TOO_LARGE",
  "NETWORK_ERROR",
  "INVALID_INPUT",
  "UNEXPECTED_RESPONSE",
] as const;

export type QualitasPaymentLinkReason = (typeof QUALITAS_PAYMENT_LINK_REASONS)[number];

export type QualitasPaymentLinkResult = {
  outcome: QualitasPaymentLinkOutcome;
  reason: QualitasPaymentLinkReason;
  paymentUrl?: string;
};

export type QualitasPaymentLinkInput = {
  policyNumber: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  deliveryMethod?: QualitasPaymentLinkDeliveryMethod;
};

export type QualitasPaymentLinkDeliveryMethod = "EMAIL" | "WHATSAPP";

export type QualitasPreparedPaymentLink = {
  policyNumber: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  deliveryMethod: QualitasPaymentLinkDeliveryMethod;
  transportReady: true;
  sessionCookie: string;
  finalActionUrl: string;
  finalFields: QualitasFormField[];
  resumeWsUrl: string;
  refererUrl: string;
};

export type QualitasFormField = {
  name: string;
  value: string;
  controlType: "input" | "select" | "textarea" | "submit" | "synthetic";
};

export type QualitasHttpTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type QualitasProviderEvent = {
  event: "qualitas.payment_link.provider";
  traceId: string;
  step: "entrypoint" | "policy_lookup" | "pagar_ahora" | "contact_form" | "final_submission";
  phase: "started" | "completed" | "classified" | "redirect" | "timeout" | "network_error" | "response_too_large" | "flow_changed";
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  redirectCount?: number;
  finalSubmission?: boolean;
  bodyBytes?: number;
  contentType?: "html" | "json" | "text" | "other" | "unknown";
  outcome?: QualitasPaymentLinkOutcome;
  reason?: QualitasPaymentLinkReason;
  signalTextLength?: number;
  hasSuccessCode?: boolean;
  hasDuplicateCode?: boolean;
  hasSuccessMessage?: boolean;
  hasDuplicateMessage?: boolean;
  hasPolicyForm?: boolean;
  hasContactForm?: boolean;
  hasResumeMarker?: boolean;
  hasVisibleContactForm?: boolean;
  hasVisibleResumeMarker?: boolean;
  hasPolicyEligibilityMessage?: boolean;
  hasEmailRejectionMessage?: boolean;
  duplicateEvidence?: "JSON_CODE" | "TEXT_CODE" | "HTML_CODE" | "HTML_MESSAGE" | "NONE";
  deliveryMethod?: QualitasPaymentLinkDeliveryMethod;
  requestVariant?: "EMAIL_NATIVE_FORM" | "WHATSAPP_TIPO_3";
  fieldCount?: number;
  hasTipoField?: boolean;
  hasEmailField?: boolean;
  hasPhoneField?: boolean;
  requestSignatureVersion?: "v2";
  requestSignature?: string;
  requestEncoding?: "FORM_URLENCODED" | "MULTIPART";
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

export function normalizeQualitasPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/\D/g, "");
  const normalized = digits.startsWith("52") && digits.length === 12 ? digits.slice(2) : digits;
  return /^\d{10}$/.test(normalized) ? normalized : null;
}

export function isValidQualitasPhone(value: string | null | undefined): value is string {
  return normalizeQualitasPhone(value) !== null;
}

export function maskQualitasPhone(value: string) {
  const normalized = normalizeQualitasPhone(value);
  return normalized ? `••••••${normalized.slice(-4)}` : "••••";
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

type QualitasResponseSignals = {
  hasSuccessCode: boolean;
  hasDuplicateCode: boolean;
  hasSuccessMessage: boolean;
  hasDuplicateMessage: boolean;
  hasPolicyForm: boolean;
  hasContactForm: boolean;
  hasResumeMarker: boolean;
  hasVisibleContactForm: boolean;
  hasVisibleResumeMarker: boolean;
  hasPolicyEligibilityMessage: boolean;
  hasEmailRejectionMessage: boolean;
};

type QualitasDuplicateEvidence = "JSON_CODE" | "TEXT_CODE" | "HTML_CODE" | "HTML_MESSAGE" | "NONE";

type QualitasProviderClassification = QualitasPaymentLinkResult & {
  contentType: QualitasProviderEvent["contentType"];
  signalTextLength: number;
  signals: QualitasResponseSignals;
  duplicateEvidence: QualitasDuplicateEvidence;
};

function emptyQualitasSignals(): QualitasResponseSignals {
  return {
    hasSuccessCode: false,
    hasDuplicateCode: false,
    hasSuccessMessage: false,
    hasDuplicateMessage: false,
    hasPolicyForm: false,
    hasContactForm: false,
    hasResumeMarker: false,
    hasVisibleContactForm: false,
    hasVisibleResumeMarker: false,
    hasPolicyEligibilityMessage: false,
    hasEmailRejectionMessage: false,
  };
}

function qualitasResult(
  outcome: QualitasPaymentLinkOutcome,
  reason: QualitasPaymentLinkReason,
): QualitasPaymentLinkResult {
  return { outcome, reason };
}

function contentTypeFamily(value: string | null | undefined): QualitasProviderEvent["contentType"] {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("json")) return "json";
  if (normalized.includes("html") || normalized.includes("xhtml")) return "html";
  if (normalized.startsWith("text/")) return "text";
  return normalized ? "other" : "unknown";
}

function classifyQualitasProviderResponse(input: {
  status?: number;
  bodyText?: string | null;
  contentType?: string | null;
  finalSubmission?: boolean;
  deliveryMethod?: QualitasPaymentLinkDeliveryMethod;
  timedOut?: boolean;
  redirectedToUnexpectedHost?: boolean;
}): QualitasProviderClassification {
  const contentType = contentTypeFamily(input.contentType);
  const visibleText = providerSignalText(input.bodyText, contentType);
  const acuseText = providerAcuseSignalText(input.bodyText, contentType);
  const text = input.finalSubmission ? acuseText : visibleText;
  const visibleMarkers = contentType === "html" ? visibleHtmlMarkers(input.bodyText ?? "") : {
    hasVisibleContactForm: false,
    hasVisibleResumeMarker: false,
  };
  const signals: QualitasResponseSignals = {
    hasSuccessCode: /(?:c[oó]digo|codigo|code)\s*[:=]?\s*["']?0\b/.test(text),
    hasDuplicateCode: /(?:c[oó]digo|codigo|code)\s*[:=]?\s*["']?99991\b/.test(text),
    hasSuccessMessage: /se\s+gener[oó]\s+(?:el\s+)?(?:link|enlace)\s+de\s+pago/.test(text) && /se\s+envi[oó].*correo/.test(text),
    hasDuplicateMessage: /(?:ya\s+se\s+encuentra|existe).*otro\s+(?:link|enlace|liga)\s+de\s+pago\s+en\s+curso|generaci[oó]n\s+de\s+(?:link|enlace|liga)\s+de\s+pago\s+.*en\s+proceso/.test(text),
    hasPolicyForm: Boolean(input.bodyText && findFormContaining(input.bodyText, "numPoliza")),
    hasContactForm: Boolean(input.bodyText && findFormContaining(input.bodyText, "temail")),
    hasResumeMarker: Boolean(input.bodyText && /\bresumenWSUrl\b/i.test(input.bodyText)),
    hasPolicyEligibilityMessage: /p[oó]liza[\s\S]{0,160}(?:no puede|no es posible|no elegible|no permite|vigencia|flotilla|endoso)[\s\S]{0,160}(?:flujo|pago|vigencia|flotilla|endoso)?/.test(text),
    hasEmailRejectionMessage: /(?:correo|e-?mail)[\s\S]{0,100}(?:rechaz|inv[aá]lid|no permitido|no acept)|(?:rechaz|inv[aá]lid|no permitido|no acept)[\s\S]{0,100}(?:correo|e-?mail)/.test(text),
    ...visibleMarkers,
  };
  const duplicateEvidence: QualitasDuplicateEvidence = contentType === "json" && (signals.hasDuplicateCode || signals.hasDuplicateMessage)
    ? "JSON_CODE"
    : contentType === "html" && signals.hasDuplicateMessage
      ? "HTML_MESSAGE"
      : contentType === "html" && !signals.hasVisibleContactForm && !signals.hasVisibleResumeMarker && signals.hasDuplicateCode
        ? "HTML_CODE"
        : contentType !== "html" && contentType !== "json" && (signals.hasDuplicateCode || signals.hasDuplicateMessage)
          ? "TEXT_CODE"
        : "NONE";
  const base = { contentType, signalTextLength: text.length, signals, duplicateEvidence };

  if (input.timedOut) {
    return { ...qualitasResult(input.finalSubmission ? "UNCERTAIN" : "TIMEOUT", input.finalSubmission ? "FINAL_TIMEOUT" : "TIMEOUT_BEFORE_SUBMISSION"), ...base };
  }
  if (input.redirectedToUnexpectedHost) {
    return { ...qualitasResult("QUALITAS_FLOW_CHANGED", "FLOW_CHANGED"), ...base };
  }
  if (signals.hasSuccessCode) return { ...qualitasResult("SUCCESS", "SUCCESS_CODE_0"), ...base };
  if (duplicateEvidence !== "NONE") {
    return { ...qualitasResult("UNCERTAIN", "DUPLICATE_LINK_99991"), ...base };
  }
  if (input.status === 429 || /too many|rate limit|demasiadas solicitudes/.test(text)) {
    return { ...qualitasResult("RATE_LIMITED", "RATE_LIMITED"), ...base };
  }
  if (input.status !== undefined && input.status >= 500) {
    return { ...qualitasResult("QUALITAS_UNAVAILABLE", "QUALITAS_UNAVAILABLE"), ...base };
  }
  if (/no se encontr|no encontr|no existe|p[oó]liza .*inv[aá]lida|not found/.test(text)) {
    return { ...qualitasResult("POLICY_NOT_FOUND", "POLICY_NOT_FOUND"), ...base };
  }
  if (signals.hasEmailRejectionMessage) {
    return { ...qualitasResult("EMAIL_REJECTED", "EMAIL_REJECTED"), ...base };
  }
  if (signals.hasPolicyEligibilityMessage || /(?:policy|p[oó]liza)[\s\S]{0,80}not eligible|not eligible[\s\S]{0,80}(?:policy|p[oó]liza)/.test(text)) {
    return { ...qualitasResult("POLICY_NOT_ELIGIBLE", "POLICY_NOT_ELIGIBLE"), ...base };
  }
  if (input.finalSubmission && input.status !== undefined && input.status < 400) {
    return { ...qualitasResult("UNCERTAIN", "FINAL_RESPONSE_UNRECOGNIZED"), ...base };
  }
  return {
    ...qualitasResult(input.status !== undefined && input.status >= 400 ? "UNEXPECTED_RESPONSE" : "QUALITAS_FLOW_CHANGED", input.status !== undefined && input.status >= 400 ? "UNEXPECTED_RESPONSE" : "FLOW_CHANGED"),
    ...base,
  };
}

export function normalizeQualitasProviderOutcome(input: {
  status?: number;
  bodyText?: string | null;
  contentType?: string | null;
  finalSubmission?: boolean;
  timedOut?: boolean;
  redirectedToUnexpectedHost?: boolean;
}): QualitasPaymentLinkOutcome {
  return classifyQualitasProviderResponse(input).outcome;
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
    .replace(/&nbsp;/gi, " ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&ntilde;/gi, "ñ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);?/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);?/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function getAttribute(source: string, name: string) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`\\b${escapedName}\\s*=\\s*([\"'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]) : null;
}

function getForms(html: string) {
  return [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((match) => match[0]);
}

function elementAttribute(node: DefaultTreeAdapterTypes.Element, name: string) {
  return node.attrs.find((attribute) => attribute.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function hasElementAttribute(node: DefaultTreeAdapterTypes.Element, name: string) {
  return node.attrs.some((attribute) => attribute.name.toLowerCase() === name.toLowerCase());
}

function textContent(node: DefaultTreeAdapterTypes.Node): string {
  if (node.nodeName === "#text") return (node as DefaultTreeAdapterTypes.TextNode).value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map((child) => textContent(child)).join("");
}

function collectFormFields(form: string, options: { includeSubmitters?: boolean } = {}): QualitasFormField[] {
  const fields: QualitasFormField[] = [];
  const document = parse(form);

  function collect(node: DefaultTreeAdapterTypes.Node) {
    if ("tagName" in node) {
      const element = node as DefaultTreeAdapterTypes.Element;
      const tagName = element.tagName.toLowerCase();
      const name = elementAttribute(element, "name");
      const disabled = hasElementAttribute(element, "disabled");
      const type = (elementAttribute(element, "type") ?? "text").toLowerCase();

      if (name && !disabled) {
        if (tagName === "input") {
          if (["button", "file", "image", "reset"].includes(type)) {
            // These controls are not successful form controls.
          } else if (type === "submit") {
            if (options.includeSubmitters) {
              fields.push({ name, value: elementAttribute(element, "value") ?? "", controlType: "submit" });
            }
          } else if (!(type === "checkbox" || type === "radio") || hasElementAttribute(element, "checked")) {
            fields.push({ name, value: elementAttribute(element, "value") ?? "", controlType: "input" });
          }
        } else if (tagName === "textarea") {
          fields.push({ name, value: textContent(element), controlType: "textarea" });
        } else if (tagName === "select") {
          const optionsInSelect: DefaultTreeAdapterTypes.Element[] = [];
          function collectOptions(child: DefaultTreeAdapterTypes.Node) {
            if ("tagName" in child) {
              const childElement = child as DefaultTreeAdapterTypes.Element;
              if (childElement.tagName.toLowerCase() === "option") optionsInSelect.push(childElement);
            }
            if ("childNodes" in child) for (const nested of child.childNodes) collectOptions(nested);
          }
          collectOptions(element);
          const selected = optionsInSelect.filter((option) => hasElementAttribute(option, "selected"));
          const values = selected.length > 0 ? selected : optionsInSelect.slice(0, 1);
          for (const option of values) {
            if (hasElementAttribute(option, "disabled")) continue;
            fields.push({ name, value: elementAttribute(option, "value") ?? textContent(option), controlType: "select" });
            if (!hasElementAttribute(element, "multiple")) break;
          }
        } else if (tagName === "button" && options.includeSubmitters && type === "submit") {
          fields.push({ name, value: elementAttribute(element, "value") ?? textContent(element).trim(), controlType: "submit" });
        }
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) collect(child);
  }

  collect(document);
  return fields;
}

function findFormContaining(html: string, fieldName: string) {
  return getForms(html).find((form) => collectFormFields(form).some((field) => field.name === fieldName)) ?? null;
}

function nodeAttribute(node: DefaultTreeAdapterTypes.Element, name: string) {
  return node.attrs.find((attribute) => attribute.name.toLowerCase() === name)?.value ?? null;
}

function isHiddenHtmlElement(node: DefaultTreeAdapterTypes.Element) {
  const tagName = node.tagName.toLowerCase();
  if (["script", "style", "template", "noscript"].includes(tagName)) return true;
  if (node.attrs.some((attribute) => attribute.name.toLowerCase() === "hidden")) return true;
  if (nodeAttribute(node, "aria-hidden")?.toLowerCase() === "true") return true;
  if (tagName === "input" && nodeAttribute(node, "type")?.toLowerCase() === "hidden") return true;
  const classTokens = (nodeAttribute(node, "class") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (["hidden", "d-none", "invisible", "visually-hidden"].some((token) => classTokens.includes(token))) return true;
  const style = nodeAttribute(node, "style")?.replace(/\s+/g, "").toLowerCase() ?? "";
  return /(?:^|;)display:none(?:;|$)/.test(style) || /(?:^|;)visibility:hidden(?:;|$)/.test(style);
}

function visibleHtmlMarkers(value: string) {
  const markers = {
    hasVisibleContactForm: false,
    hasVisibleResumeMarker: false,
  };
  const document = parse(value);

  function collectFormFields(
    node: DefaultTreeAdapterTypes.Node,
    inheritedHidden: boolean,
    fields: { contact: boolean; resume: boolean },
  ) {
    if ("tagName" in node) {
      const element = node as DefaultTreeAdapterTypes.Element;
      const hidden = inheritedHidden || isHiddenHtmlElement(element);
      const tagName = element.tagName.toLowerCase();
      const name = nodeAttribute(element, "name")?.toLowerCase();
      const type = nodeAttribute(element, "type")?.toLowerCase();
      if (!hidden && name === "resumenwsurl") fields.resume = true;
      if (!hidden && name === "temail" && !(tagName === "input" && type === "hidden")) fields.contact = true;
      if (hidden) return;
    }
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) collectFormFields(child, inheritedHidden, fields);
  }

  function visit(node: DefaultTreeAdapterTypes.Node, inheritedHidden: boolean) {
    if ("tagName" in node) {
      const element = node as DefaultTreeAdapterTypes.Element;
      const hidden = inheritedHidden || isHiddenHtmlElement(element);
      if (element.tagName.toLowerCase() === "form" && !hidden) {
        const fields = { contact: false, resume: false };
        collectFormFields(element, false, fields);
        markers.hasVisibleContactForm ||= fields.contact;
        markers.hasVisibleResumeMarker ||= fields.resume;
      }
      if (hidden) return;
    }
    if (!("childNodes" in node)) return;
    for (const child of node.childNodes) visit(child, inheritedHidden);
  }

  visit(document, false);
  return markers;
}

function collectVisibleHtmlText(node: DefaultTreeAdapterTypes.Node, output: string[]) {
  if (node.nodeName === "#text") {
    output.push((node as DefaultTreeAdapterTypes.TextNode).value);
    return;
  }
  if ("tagName" in node && isHiddenHtmlElement(node as DefaultTreeAdapterTypes.Element)) return;
  if (!("childNodes" in node)) return;
  for (const child of node.childNodes) collectVisibleHtmlText(child, output);
}

function visibleHtmlText(value: string) {
  const output: string[] = [];
  collectVisibleHtmlText(parse(value), output);
  return output.join(" ").replace(/\s+/g, " ").trim();
}

function collectJsonSignalText(value: unknown, output: string[]) {
  if (value === null || value === undefined) return;
  if (["string", "number", "boolean"].includes(typeof value)) {
    output.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectJsonSignalText(item, output);
    return;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      output.push(key);
      collectJsonSignalText(nested, output);
    }
  }
}

function providerSignalText(
  value: string | null | undefined,
  contentType: QualitasProviderEvent["contentType"] = "unknown",
) {
  const source = value ?? "";
  const trimmed = source.trim();
  if (contentType === "json" || /^[\[{]/.test(trimmed)) {
    try {
      const output: string[] = [];
      collectJsonSignalText(JSON.parse(trimmed), output);
      return output.join(" ").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
    } catch {
      // Fall through to the HTML/text parser so malformed JSON still fails closed.
    }
  }
  return visibleHtmlText(source).normalize("NFKC").toLowerCase();
}

function providerAcuseSignalText(
  value: string | null | undefined,
  contentType: QualitasProviderEvent["contentType"],
) {
  const text = providerSignalText(value, contentType);
  const codeMatch = text.match(/\b(?:c[oó]digo|codigo|code)\s*[:=]?\s*["']?\d+/i);
  if (!codeMatch || codeMatch.index === undefined) return "";
  const block = text.slice(codeMatch.index, codeMatch.index + 2_000);
  const messageMatch = block.match(/\b(?:mensaje|message)\s*[:=]?/i);
  if (!messageMatch || messageMatch.index === undefined) return "";
  return block.slice(0, Math.min(block.length, messageMatch.index + 1_000));
}

function findPagarAhoraRequest(html: string, baseUrl: string) {
  const pagarForm = getForms(html).find((form) => /pagar\s+ahora/i.test(visibleHtmlText(form)));
  if (pagarForm) {
    const action = formAction(pagarForm, baseUrl);
    if (!action || !isAllowedQualitasUrl(action)) return null;
    const fields = collectFormFields(pagarForm, { includeSubmitters: true }).filter((field) => (
      field.controlType !== "submit" || /pagar\s+ahora/i.test(`${field.name} ${field.value}`)
    ));
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

function setFormField(fields: QualitasFormField[], name: string, value: string) {
  const next = fields.map((field) => ({ ...field }));
  const index = next.findIndex((field) => field.name === name);
  if (index >= 0) {
    next[index] = { ...next[index], value };
    return next;
  }
  next.push({ name, value, controlType: "synthetic" });
  return next;
}

function valueShape(name: string, value: string) {
  if (!value) return "empty";
  if (name === "tipo") return ["1", "2", "3"].includes(value) ? value : "other";
  if (name === "temail") return isValidQualitasEmail(value) ? "email" : "invalid-email";
  if (name === "numTelefono") return isValidQualitasPhone(value) ? "phone" : "invalid-phone";
  if (name === "resumenWSUrl") {
    try {
      return isAllowedQualitasUrl(value) ? `url:${new URL(value).pathname}` : "external-url";
    } catch {
      return "invalid-url";
    }
  }
  return "nonempty";
}

export function qualitasRequestShapeSignature(fields: QualitasFormField[], deliveryMethod: QualitasPaymentLinkDeliveryMethod) {
  const source = `${deliveryMethod}|${fields.map((field) => `${field.name}:${valueShape(field.name, field.value)}`).join("|")}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `v2-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildQualitasDeliveryFields(input: {
  fields: QualitasFormField[];
  deliveryMethod: QualitasPaymentLinkDeliveryMethod;
  recipientEmail: string | null;
  recipientPhone: string | null;
  resumeWsUrl: string;
}) {
  const channelFields: QualitasFormField[] = [
    { name: "numTelefono", value: input.recipientPhone ?? "", controlType: "synthetic" },
    { name: "temail", value: input.recipientEmail ?? "", controlType: "synthetic" },
    { name: "tipo", value: input.deliveryMethod === "WHATSAPP" ? "3" : "1", controlType: "synthetic" },
    { name: "resumenWSUrl", value: input.resumeWsUrl, controlType: "synthetic" },
  ];
  const passthroughFields = input.fields.filter((field) => !["numTelefono", "temail", "tipo", "resumenWSUrl"].includes(field.name));
  return [...channelFields, ...passthroughFields.map((field) => ({ ...field }))];
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
  redirectCount?: number;
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
      return { finalUrl: url, redirectCount: redirect, redirectedToUnexpectedHost: true };
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
          return { response, finalUrl: url, redirectCount: redirect, bodyText: "" };
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
          return { response, finalUrl: nextUrl, redirectCount: redirect + 1, redirectedToUnexpectedHost: !isAllowedQualitasUrl(nextUrl) };
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
        contentType: contentTypeFamily(response.headers.get("content-type")),
      });
      return { response, bodyText, finalUrl: url, redirectCount: redirect };
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
        return { finalUrl: url, redirectCount: redirect, responseTooLarge: true };
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
        return { finalUrl: url, redirectCount: redirect, timedOut: true };
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
      return { finalUrl: url, redirectCount: redirect, networkError: true };
    } finally {
      clearTimeout(timer);
    }
  }

  return { finalUrl: url, redirectCount: MAX_REDIRECTS, redirectedToUnexpectedHost: true };
}

function resultForSessionResponse(
  result: SessionResponse,
  finalSubmission: boolean,
  options: QualitasRequestOptions,
  deliveryMethod?: QualitasPaymentLinkDeliveryMethod,
  requestShape?: {
    requestVariant: "EMAIL_NATIVE_FORM" | "WHATSAPP_TIPO_3";
    fieldCount: number;
    hasTipoField: boolean;
    hasEmailField: boolean;
    hasPhoneField: boolean;
  },
): QualitasPaymentLinkResult {
  let classification: QualitasProviderClassification;
  if (result.responseTooLarge) {
    classification = {
      ...qualitasResult(finalSubmission ? "UNCERTAIN" : "UNEXPECTED_RESPONSE", "RESPONSE_TOO_LARGE"),
      contentType: "unknown",
      signalTextLength: 0,
      signals: emptyQualitasSignals(),
      duplicateEvidence: "NONE",
    };
  } else if (result.networkError) {
    classification = {
      ...qualitasResult(finalSubmission ? "UNCERTAIN" : "QUALITAS_UNAVAILABLE", "NETWORK_ERROR"),
      contentType: "unknown",
      signalTextLength: 0,
      signals: emptyQualitasSignals(),
      duplicateEvidence: "NONE",
    };
  } else {
    classification = classifyQualitasProviderResponse({
      status: result.response?.status,
      bodyText: result.bodyText,
      contentType: result.response?.headers.get("content-type"),
      finalSubmission,
      deliveryMethod,
      timedOut: result.timedOut,
      redirectedToUnexpectedHost: result.redirectedToUnexpectedHost,
    });
  }

  if (finalSubmission) {
    emitQualitasProviderEvent(options, {
      step: "final_submission",
      phase: "classified",
      path: safeQualitasPath(result.finalUrl),
      status: result.response?.status,
      redirectCount: result.redirectCount,
      finalSubmission: true,
      contentType: classification.contentType,
      outcome: classification.outcome,
      reason: classification.reason,
      deliveryMethod,
      ...requestShape,
      signalTextLength: classification.signalTextLength,
      duplicateEvidence: classification.duplicateEvidence,
      ...classification.signals,
    });
  }
  return qualitasResult(classification.outcome, classification.reason);
}

export async function prepareQualitasPaymentLink(
  input: QualitasPaymentLinkInput,
  options: QualitasRequestOptions = {},
): Promise<QualitasPreparedPaymentLink | QualitasPaymentLinkResult> {
  const deliveryMethod = input.deliveryMethod ?? "EMAIL";
  const recipientEmail = normalizeQualitasEmail(input.recipientEmail);
  const recipientPhone = normalizeQualitasPhone(input.recipientPhone);
  if (!input.policyNumber.trim() || (deliveryMethod === "EMAIL" ? !recipientEmail : !recipientPhone)) {
    return qualitasResult("UNEXPECTED_RESPONSE", "INVALID_INPUT");
  }

  const policyNumber = normalizeQualitasPolicyNumber(input.policyNumber);
  if (!policyNumber) return qualitasResult("UNEXPECTED_RESPONSE", "INVALID_INPUT");
  const cookieJar = new Map<string, string>();
  const initial = await requestWithSession({
    url: QUALITAS_PAYMENT_LINK_ENTRYPOINT,
    init: { method: "GET", headers: { Accept: "text/html" } },
    cookieJar,
    options,
    finalSubmission: false,
    step: "entrypoint",
  });
  if (!initial.bodyText) return resultForSessionResponse(initial, false, options);

  const policyForm = findFormContaining(initial.bodyText, "numPoliza");
  if (!policyForm || formMethod(policyForm) !== "POST") return qualitasResult("QUALITAS_FLOW_CHANGED", "FLOW_CHANGED");
  const policyAction = formAction(policyForm, initial.finalUrl);
  if (!policyAction || !isAllowedQualitasUrl(policyAction)) return qualitasResult("QUALITAS_FLOW_CHANGED", "FLOW_CHANGED");
  const policyFields = collectFormFields(policyForm);
  const policyBody = new URLSearchParams(
    setFormField(policyFields, "numPoliza", policyNumber).map((field): [string, string] => [field.name, field.value]),
  );
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
  if (!policyResponse.bodyText) return resultForSessionResponse(policyResponse, false, options);

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
      return resultForSessionResponse(policyResponse, false, options);
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
            body: new URLSearchParams(
              Array.isArray(pagarAhora.fields)
                ? pagarAhora.fields.map((field): [string, string] => [field.name, field.value])
                : Object.entries(pagarAhora.fields),
            ),
          },
      cookieJar,
      options,
      finalSubmission: false,
      step: "pagar_ahora",
    });
    const pagarHtml = pagarResponse.bodyText;
    if (!pagarHtml) return resultForSessionResponse(pagarResponse, false, options);
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
    return resultForSessionResponse(contactPage, false, options);
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
  const finalFields = collectFormFields(contactForm);
  const resumeWsUrl = finalFields.find((field) => field.name === "resumenWSUrl")?.value ?? "";
  if (!finalActionUrl || !isAllowedQualitasUrl(finalActionUrl) || !resumeWsUrl || !isAllowedQualitasUrl(resumeWsUrl)) {
    return qualitasResult("QUALITAS_FLOW_CHANGED", "FLOW_CHANGED");
  }

  return {
    policyNumber,
    recipientEmail,
    recipientPhone,
    deliveryMethod,
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
  const destinationIsValid = prepared.deliveryMethod === "EMAIL"
    ? isValidQualitasEmail(prepared.recipientEmail)
    : isValidQualitasPhone(prepared.recipientPhone);
  if (
    !prepared.transportReady ||
    !destinationIsValid ||
    !isAllowedQualitasUrl(prepared.finalActionUrl) ||
    !isAllowedQualitasUrl(prepared.resumeWsUrl)
  ) {
    return !prepared.transportReady || !isAllowedQualitasUrl(prepared.finalActionUrl) || !isAllowedQualitasUrl(prepared.resumeWsUrl)
      ? qualitasResult("QUALITAS_FLOW_CHANGED", "FLOW_CHANGED")
      : qualitasResult("UNEXPECTED_RESPONSE", "INVALID_INPUT");
  }
  const cookieJar = new Map<string, string>();
  for (const pair of prepared.sessionCookie.split(/;\s*/)) {
    const separator = pair.indexOf("=");
    if (separator > 0) cookieJar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  const finalFields = buildQualitasDeliveryFields({
    fields: prepared.finalFields,
    deliveryMethod: prepared.deliveryMethod,
    recipientEmail: prepared.recipientEmail,
    recipientPhone: prepared.recipientPhone,
    resumeWsUrl: prepared.resumeWsUrl,
  });
  const fields = new URLSearchParams();
  for (const field of finalFields) fields.append(field.name, field.value);
  const requestShape = {
    requestVariant: prepared.deliveryMethod === "EMAIL" ? "EMAIL_NATIVE_FORM" as const : "WHATSAPP_TIPO_3" as const,
    fieldCount: finalFields.length,
    hasTipoField: finalFields.some((field) => field.name === "tipo"),
    hasEmailField: finalFields.some((field) => field.name === "temail"),
    hasPhoneField: finalFields.some((field) => field.name === "numTelefono"),
    requestSignatureVersion: "v2" as const,
    requestSignature: qualitasRequestShapeSignature(finalFields, prepared.deliveryMethod),
    requestEncoding: "FORM_URLENCODED" as const,
  };

  const response = await requestWithSession({
    url: prepared.finalActionUrl,
    init: {
      method: "POST",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Origin: new URL(prepared.finalActionUrl).origin,
        Referer: prepared.refererUrl,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: fields,
    },
    cookieJar,
    options,
    finalSubmission: true,
    step: "final_submission",
  });
  return resultForSessionResponse(response, true, options, prepared.deliveryMethod, requestShape);
}
