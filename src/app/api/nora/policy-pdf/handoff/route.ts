import { NextRequest, NextResponse } from "next/server";
import { del, get, list, put } from "@vercel/blob";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { assertSameOrigin, readJsonBody } from "@/lib/request-guards";
import { logError } from "@/lib/logger";
import {
  buildNoraCaptureHandoffPathname,
  isNoraCaptureHandoffPathname,
  NORA_CAPTURE_HANDOFF_MAX_AGE_MS,
  NORA_CAPTURE_HANDOFF_MAX_BYTES,
  NORA_CAPTURE_HANDOFF_PREFIX,
} from "@/lib/nora-capture-handoff-storage.shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handoffSchema = z.object({
  handoffId: z.string().trim().min(1).max(160),
  payload: z.record(z.string(), z.unknown()),
});

function responseForError(error: unknown) {
  const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
  if (status === 401 || status === 403) return { status, code: "HANDOFF_UNAUTHORIZED", error: "La ficha temporal no está autorizada." };
  if (status === 413) return { status, code: "HANDOFF_REJECTED", error: "La ficha temporal supera el tamaño permitido." };
  return { status: 500, code: "HANDOFF_SERVER_ERROR", error: "No se pudo conservar la ficha temporal." };
}

async function userOrError() {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw error;
  }
}

async function cleanupExpired(userId: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return;
  const cutoff = Date.now() - NORA_CAPTURE_HANDOFF_MAX_AGE_MS;
  const { blobs } = await list({ prefix: `${NORA_CAPTURE_HANDOFF_PREFIX}/${userId}/`, limit: 100 });
  await Promise.all(blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff).map((blob) => del(blob.url)));
}

export async function POST(request: NextRequest) {
  try {
    const user = await userOrError();
    try { assertSameOrigin(request, "nora policy capture handoff"); } catch { return NextResponse.json({ error: "No autorizado.", code: "HANDOFF_UNAUTHORIZED" }, { status: 403 }); }
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return NextResponse.json({ error: "El almacenamiento temporal no está configurado.", code: "BLOB_NOT_CONFIGURED" }, { status: 503 });
    const parsed = handoffSchema.parse(await readJsonBody(request, NORA_CAPTURE_HANDOFF_MAX_BYTES));
    const pathname = buildNoraCaptureHandoffPathname(user.id, parsed.handoffId);
    const body = JSON.stringify({ ownerId: user.id, handoffId: parsed.handoffId, expiresAt: Date.now() + NORA_CAPTURE_HANDOFF_MAX_AGE_MS, payload: parsed.payload });
    if (new TextEncoder().encode(body).byteLength > NORA_CAPTURE_HANDOFF_MAX_BYTES) {
      return NextResponse.json({ error: "La ficha temporal supera el tamaño permitido.", code: "HANDOFF_REJECTED" }, { status: 413 });
    }
    const blob = await put(pathname, body, { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", cacheControlMaxAge: 0 });
    await cleanupExpired(user.id).catch((error) => logError("api.nora.policyPdf.handoff.cleanup", error));
    return NextResponse.json({ success: true, handoffId: parsed.handoffId, expiresAt: Date.now() + NORA_CAPTURE_HANDOFF_MAX_AGE_MS, url: blob.url });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La ficha temporal no es válida.", code: "HANDOFF_REJECTED" }, { status: 400 });
    const response = responseForError(error);
    logError("api.nora.policyPdf.handoff.save", error);
    return NextResponse.json({ error: response.error, code: response.code }, { status: response.status });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await userOrError();
    const handoffId = request.nextUrl.searchParams.get("handoffId")?.trim() ?? "";
    if (!handoffId || handoffId.length > 160) return NextResponse.json({ error: "Falta handoffId.", code: "HANDOFF_REJECTED" }, { status: 400 });
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return NextResponse.json({ error: "El almacenamiento temporal no está configurado.", code: "BLOB_NOT_CONFIGURED" }, { status: 503 });
    const pathname = buildNoraCaptureHandoffPathname(user.id, handoffId);
    if (!isNoraCaptureHandoffPathname(pathname, user.id, handoffId)) return NextResponse.json({ error: "La ficha temporal no pertenece a tu sesión.", code: "HANDOFF_UNAUTHORIZED" }, { status: 403 });
    const blob = await get(pathname, { access: "private" });
    if (!blob) return NextResponse.json({ error: "La ficha temporal expiró o ya no existe.", code: "HANDOFF_NOT_FOUND" }, { status: 404 });
    const raw = await new Response(blob.stream).text();
    const parsed = JSON.parse(raw) as { ownerId?: unknown; handoffId?: unknown; expiresAt?: unknown; payload?: unknown };
    if (parsed.ownerId !== user.id || parsed.handoffId !== handoffId || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now() || !parsed.payload || typeof parsed.payload !== "object") {
      await del(pathname).catch(() => undefined);
      return NextResponse.json({ error: "La ficha temporal expiró o es inválida.", code: "HANDOFF_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ success: true, handoff: { version: 5, ownerId: user.id, createdAt: blob.blob.uploadedAt.getTime(), expiresAt: parsed.expiresAt, payload: parsed.payload } });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("api.nora.policyPdf.handoff.load", error);
    return NextResponse.json({ error: "No se pudo restaurar la ficha temporal.", code: "HANDOFF_SERVER_ERROR" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await userOrError();
    try { assertSameOrigin(request, "nora policy capture handoff delete"); } catch { return NextResponse.json({ error: "No autorizado.", code: "HANDOFF_UNAUTHORIZED" }, { status: 403 }); }
    const handoffId = request.nextUrl.searchParams.get("handoffId")?.trim() ?? "";
    if (!handoffId || handoffId.length > 160) return NextResponse.json({ error: "Falta handoffId.", code: "HANDOFF_REJECTED" }, { status: 400 });
    if (process.env.BLOB_READ_WRITE_TOKEN?.trim()) await del(buildNoraCaptureHandoffPathname(user.id, handoffId)).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("api.nora.policyPdf.handoff.delete", error);
    return NextResponse.json({ error: "No se pudo eliminar la ficha temporal.", code: "HANDOFF_SERVER_ERROR" }, { status: 500 });
  }
}
