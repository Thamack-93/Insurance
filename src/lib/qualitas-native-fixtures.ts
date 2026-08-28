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
