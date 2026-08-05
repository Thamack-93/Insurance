import * as XLSX from "@e965/xlsx";

export type ExportCell = string | number | boolean | Date | null | undefined;

export type ExportColumn<T> = {
  clave: keyof T & string;
  etiqueta: string;
  formatear?: (valor: unknown, fila: T) => ExportCell;
};

export type ExportSheet<T> = {
  nombre: string;
  columnas: Array<ExportColumn<T>>;
  filas: T[];
};

export function toCsv<T>(filas: T[], columnas: Array<ExportColumn<T>>) {
  const header = columnas.map((column) => escapeCsv(column.etiqueta)).join(",");
  const body = filas
    .map((fila) =>
      columnas
        .map((column) => {
          const value = column.formatear?.((fila as Record<string, unknown>)[column.clave], fila);
          return escapeCsv(normalizeCell(value ?? (fila as Record<string, unknown>)[column.clave]));
        })
        .join(","),
    )
    .join("\n");

  return [header, body].filter(Boolean).join("\n");
}

export function toWorkbook(sheets: Array<ExportSheet<Record<string, unknown>>>) {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const rows = sheet.filas.map((fila) => {
      const row: Record<string, ExportCell> = {};
      const rowValue = fila as Record<string, unknown>;

      for (const column of sheet.columnas) {
        const value = column.formatear?.(rowValue[column.clave], fila);
        row[column.etiqueta] = normalizeCell(value ?? rowValue[column.clave]);
      }

      return row;
    });

    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, normalizeSheetName(sheet.nombre));
  }

  return workbook;
}

export function workbookToBuffer(workbook: XLSX.WorkBook) {
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

export function sheetToCsv<T>(sheet: ExportSheet<T>) {
  return toCsv(sheet.filas, sheet.columnas);
}

export function normalizeCell(value: unknown): ExportCell {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

function escapeCsv(value: unknown) {
  const text = normalizeCell(value);
  const stringValue = typeof text === "string" ? text : String(text);

  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

function normalizeSheetName(name: string) {
  const sanitized = name.replace(/[\[\]:*?/\\]/g, " ").trim();
  return sanitized.slice(0, 31) || "Hoja1";
}
