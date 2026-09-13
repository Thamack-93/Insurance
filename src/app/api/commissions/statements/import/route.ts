import { NextRequest, NextResponse } from "next/server";
import { createCommissionStatement } from "@/lib/commission-reconciliation";
import { AuthError } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Adjunta un CSV o XLSX." }, { status: 400 });
    const mimeType = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : file.name.toLowerCase().endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv");
    const statement = await createCommissionStatement({ fileName: file.name.slice(0, 255), mimeType, buffer: Buffer.from(await file.arrayBuffer()), periodStart: typeof form.get("periodStart") === "string" ? new Date(String(form.get("periodStart"))) : undefined, periodEnd: typeof form.get("periodEnd") === "string" ? new Date(String(form.get("periodEnd"))) : undefined });
    return NextResponse.json({ ok: true, id: statement.id, status: statement.status }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    const code = error instanceof Error ? error.message : "IMPORT_FAILED";
    return NextResponse.json({ ok: false, error: code === "COMMISSION_STATEMENT_DUPLICATE" ? "Este archivo ya fue importado." : "No se pudo importar el estado de comisiones." }, { status: code === "COMMISSION_IMPORT_FORBIDDEN" ? 403 : 400 });
  }
}
