import { NextResponse, type NextRequest } from "next/server";

import { AuthError } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { toCsv, toWorkbook, workbookToBuffer } from "@/lib/export";
import { EXPORT_DATASETS, isExportDatasetKey } from "@/lib/export-datasets";
import { logError } from "@/lib/logger";
import type { TableSearchParams } from "@/lib/table-query";

const FORMATS = ["csv", "xlsx"] as const;
type ExportFormat = (typeof FORMATS)[number];

function readFormat(value: string | null): ExportFormat | null {
  return FORMATS.includes(value as ExportFormat) ? (value as ExportFormat) : null;
}

function toTableSearchParams(searchParams: URLSearchParams): TableSearchParams {
  const params: TableSearchParams = {};

  for (const key of new Set(searchParams.keys())) {
    if (key === "format") continue;
    const values = searchParams.getAll(key);
    params[key] = values.length > 1 ? values : values[0];
  }

  return params;
}

function contentDisposition(fileName: string) {
  // ASCII fallback plus the RFC 5987 form, so accented names survive.
  const ascii = fileName.normalize("NFD").replace(/[^\x20-\x7e]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;

  if (!isExportDatasetKey(dataset)) {
    return NextResponse.json({ error: "Conjunto de datos no disponible." }, { status: 404 });
  }

  const requestedFormat = request.nextUrl.searchParams.get("format");
  const format = requestedFormat === null ? "csv" : readFormat(requestedFormat);

  if (format === null) {
    return NextResponse.json(
      { error: `Formato no disponible. Usa ${FORMATS.join(" o ")}.` },
      { status: 400 },
    );
  }

  try {
    const context = await requireOrganizationContext();
    const capability = await resolveOrganizationCapability(context.organizationId, "EXPORTS");
    if (!capability.enabled) return NextResponse.json({ error: "Las exportaciones no están habilitadas para esta organización." }, { status: 403 });
    // `load` resolves the portfolio scope itself, so the export can never
    // return rows the requesting user cannot already see on screen.
    const result = await EXPORT_DATASETS[dataset].load(
      toTableSearchParams(request.nextUrl.searchParams),
    );

    const stamp = new Date().toISOString().slice(0, 10);
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Export-Rows": String(result.rows.length),
      ...(result.truncated ? { "X-Export-Truncated": "1" } : {}),
    });

    if (format === "xlsx") {
      const buffer = workbookToBuffer(
        toWorkbook([{ nombre: result.sheetName, columnas: result.columns, filas: result.rows }]),
      );

      headers.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      headers.set("Content-Disposition", contentDisposition(`${result.fileBaseName}-${stamp}.xlsx`));

      return new NextResponse(new Uint8Array(buffer), { headers });
    }

    headers.set("Content-Type", "text/csv; charset=utf-8");
    headers.set("Content-Disposition", contentDisposition(`${result.fileBaseName}-${stamp}.csv`));

    // The BOM keeps Excel from mangling accents when it opens the CSV.
    return new NextResponse(`\uFEFF${toCsv(result.rows, result.columns)}`, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: "No autorizado." }, { status: error.status });
    }

    logError("export.route", error, { dataset, format });
    return NextResponse.json({ error: "No se pudo generar la exportación." }, { status: 500 });
  }
}
