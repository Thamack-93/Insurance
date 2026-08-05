import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { clientOperationalWhere } from "@/lib/portfolio-access";
import { toWorkbook, workbookToBuffer, type ExportSheet } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeFilePart(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "organizacion";
}

export async function GET() {
  const scope = await requireOrganizationPortfolioReadScope();
  const db = getDb();
  const clients = await db.client.findMany({
    where: clientOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      type: true,
      status: true,
      email: true,
      phone: true,
      rfc: true,
      createdAt: true,
      _count: { select: { policies: true, receipts: true } },
    },
  });

  const generatedAt = new Date();
  type ClientRow = (typeof clients)[number];
  const sheet: ExportSheet<Record<string, unknown>> = {
    nombre: "Clientes",
    columnas: [
      { clave: "id", etiqueta: "ID" },
      { clave: "fullName", etiqueta: "Nombre" },
      { clave: "type", etiqueta: "Tipo" },
      { clave: "status", etiqueta: "Estado" },
      { clave: "email", etiqueta: "Email" },
      { clave: "phone", etiqueta: "Teléfono" },
      { clave: "rfc", etiqueta: "RFC" },
      { clave: "policies", etiqueta: "Pólizas" },
      { clave: "receipts", etiqueta: "Recibos" },
      { clave: "createdAt", etiqueta: "Creado" },
    ],
    filas: clients.map((client: ClientRow) => ({
      id: client.id,
      fullName: client.fullName,
      type: client.type,
      status: client.status,
      email: client.email,
      phone: client.phone,
      rfc: client.rfc,
      policies: client._count.policies,
      receipts: client._count.receipts,
      createdAt: client.createdAt,
    })),
  };

  const meta: ExportSheet<Record<string, unknown>> = {
    nombre: "Información",
    columnas: [
      { clave: "campo", etiqueta: "Campo" },
      { clave: "valor", etiqueta: "Valor" },
    ],
    filas: [
      { campo: "Organización", valor: scope.context.organizationName },
      { campo: "Generado", valor: generatedAt },
      { campo: "Registros", valor: clients.length },
    ],
  };

  const workbook = toWorkbook([meta, sheet]);
  const buffer = workbookToBuffer(workbook);
  const filename = `policydesk-clientes-${safeFilePart(scope.context.organizationSlug)}-${generatedAt.toISOString().slice(0, 10)}.xlsx`;
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
