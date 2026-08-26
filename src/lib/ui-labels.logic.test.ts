import { describe, expect, it } from "vitest";
import {
  assistantAiStatusLabel,
  backupCapabilityLabel,
  dataQualityStatusLabel,
  roleLabel,
  searchEntityLabel,
} from "@/lib/ui-labels";

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
});
