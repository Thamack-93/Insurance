import { describe, expect, it } from "vitest";
import { normalizeCell, sheetToCsv } from "@/lib/export";

describe("export cell safety", () => {
  it.each(["=SUM(A1:A2)", "+cmd", "-10+2", "@user"]) ("prefixes formula-like value %s", (value) => {
    expect(normalizeCell(value)).toBe(`'${value}`);
  });

  it("preserves ordinary values and escapes csv", () => {
    expect(normalizeCell("Cliente, SA")).toBe("Cliente, SA");
    expect(sheetToCsv({ nombre: "Clientes", columnas: [{ clave: "name", etiqueta: "Nombre" }], filas: [{ name: "Cliente, SA" }] })).toContain('"Cliente, SA"');
  });
});
