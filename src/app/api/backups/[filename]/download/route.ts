import { NextResponse } from "next/server";
import { getBackupDownload } from "@/lib/backup";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  try {
    await requireSuperAdmin();
    const { filename } = await params;
    const decoded = decodeURIComponent(filename);
    const result = await getBackupDownload(decoded);
    if (result?.statusCode !== 200 || !result.stream) {
      return NextResponse.json(
        { error: "El respaldo ya no se encuentra disponible." },
        { status: 404 },
      );
    }

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${decoded}"`,
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (result.blob.size !== null) headers.set("Content-Length", String(result.blob.size));
    return new NextResponse(result.stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "Invalid backup filename.") {
      return NextResponse.json({ error: "Nombre de respaldo no válido." }, { status: 400 });
    }
    logError("api.backups.download", error);
    return NextResponse.json(
      { error: "No se pudo descargar el respaldo. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
