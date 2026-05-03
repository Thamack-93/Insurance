import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { assertSafeBackupPath } from "@/lib/files";
import { AuthError, requireAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    await requireAdmin();
    const { filename } = await params;
    const decoded = decodeURIComponent(filename);
    const safePath = assertSafeBackupPath(decoded);
    const fileBuffer = await readFile(safePath);

    const headers = new Headers();
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", `attachment; filename="${decoded}"`);
    headers.set("Content-Length", fileBuffer.length.toString());

    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.backups.download", error);

    if (error instanceof Error && error.message.includes("Backup path must stay")) {
      return NextResponse.json({ error: "Ruta de respaldo no válida." }, { status: 403 });
    }

    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "El respaldo ya no se encuentra disponible." }, { status: 404 });
    }

    return NextResponse.json(
      { error: "No se pudo descargar el respaldo. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
