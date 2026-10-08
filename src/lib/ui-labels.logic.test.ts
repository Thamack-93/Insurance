import { describe, expect, it } from "vitest";
import {
  assistantAiStatusLabel,
  backupCapabilityLabel,
  dataQualityStatusLabel,
  dataQualityReasonLabel,
  documentTypeLabel,
  paymentMethodLabel,
  roleLabel,
  searchEntityLabel,
  workItemTypeLabel,
} from "@/lib/ui-labels";
import { policyTypeLabel, priorityLabel, statusLabel } from "@/lib/status";
import { appendReturnTo, normalizeReturnTo } from "@/lib/return-to";

describe("etiquetas visibles de la interfaz", () => {
  it("traduce roles y entidades de búsqueda", () => {
    expect(roleLabel("OWNER")).toBe("Propietario");
    expect(roleLabel("ADMIN")).toBe("Administrador");
    expect(searchEntityLabel("policy")).toBe("Póliza");
  });

  it("traduce capacidades y estados técnicos", () => {
    expect(backupCapabilityLabel("DATABASE_ONLY")).toBe("Respaldo de datos sin archivos documentales");
    expect(assistantAiStatusLabel("SUCCEEDED")).toBe("Exitoso");
    expect(dataQualityStatusLabel("PREVIEW_READY")).toBe("Vista previa lista");
  });

  it("mantiene códigos internos fuera de la interfaz y usa fallbacks seguros", () => {
    expect(statusLabel("UNKNOWN", "policy")).toBe("Estado no reconocido");
    expect(priorityLabel("UNKNOWN")).toBe("Prioridad no reconocida");
    expect(policyTypeLabel("UNKNOWN")).toBe("Tipo no reconocido");
    expect(workItemTypeLabel("TASK")).toBe("Pendiente");
    expect(documentTypeLabel("PAYMENT_PROOF")).toBe("Comprobante de pago");
    expect(paymentMethodLabel("TRANSFER")).toBe("Transferencia bancaria");
    expect(paymentMethodLabel("DOMICILIATED")).toBe("Domiciliado");
    expect(dataQualityReasonLabel("payment_after_due_date")).toBe("Pago después del vencimiento");
    expect(dataQualityReasonLabel("UNKNOWN_REASON")).toBe("Revisión requerida");
  });

  it("valida el retorno contextual sin permitir rutas externas", () => {
    expect(normalizeReturnTo("/operations?view=pending&q=cliente&page=2", "/clients")).toBe("/operations?view=pending&q=cliente&page=2");
    expect(normalizeReturnTo("https://example.com/phishing", "/clients")).toBe("/clients");
    expect(appendReturnTo("/policies/123", "/operations?view=renewals&page=2")).toBe("/policies/123?returnTo=%2Foperations%3Fview%3Drenewals%26page%3D2");
  });
});
