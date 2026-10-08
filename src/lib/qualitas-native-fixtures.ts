import type { QualitasFormField } from "./qualitas-payment-link";

export const QUALITAS_NATIVE_REQUEST_FIXTURES = {
  EMAIL: {
    encoding: "FORM_URLENCODED" as const,
    fields: [
      { name: "numTelefono", value: "", controlType: "synthetic" },
      { name: "temail", value: "redacted@example.com", controlType: "synthetic" },
      { name: "tipo", value: "1", controlType: "synthetic" },
      { name: "resumenWSUrl", value: "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/resumen-ws", controlType: "synthetic" },
    ] satisfies QualitasFormField[],
    signature: "v2-ae8d79f1",
  },
  WHATSAPP: {
    encoding: "FORM_URLENCODED" as const,
    fields: [
      { name: "numTelefono", value: "5512345678", controlType: "synthetic" },
      { name: "temail", value: "", controlType: "synthetic" },
      { name: "tipo", value: "3", controlType: "synthetic" },
      { name: "resumenWSUrl", value: "https://www.qualitas.com.mx/web/qmx/pago-de-poliza/-/user-pago/resumen-ws", controlType: "synthetic" },
    ] satisfies QualitasFormField[],
    signature: "v2-b4e023c1",
  },
} as const;

export const QUALITAS_FINAL_RESPONSE_FIXTURES = {
  EMAIL_SUCCESS_WITHOUT_MESSAGE_LABEL:
    "<main>Código: 0 - Se genero link de pago y se envio a redacted@example.com.</main>",
  HIDDEN_SUCCESS_CODE:
    "<script>const legacyCode = 0;</script><main>Solicitud recibida</main>",
} as const;

export const QUALITAS_RECEIPT_MONITOR_FIXTURES = {
  NEXT_RECEIPT_TABLE: `<table><thead><tr><th>Recibo</th><th>Fecha límite de pago</th></tr></thead><tbody><tr><td>12</td><td>12/11/2026</td></tr><tr><td>13</td><td>12/12/2026</td></tr></tbody></table>`,
  CHALLENGE: `<main>Access denied. Incapsula incident ID.</main>`,
  CHANGED_FLOW: `<main>El servicio se encuentra temporalmente fuera de servicio.</main>`,
} as const;
