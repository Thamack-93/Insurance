import { NextResponse } from "next/server";
import { getBackupDownload } from "@/lib/backup";
import { getBackupArtifact } from "@/lib/backup-catalog";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  try {
    await requireSuperAdmin();
    const { artifactId } = await params;
    const artifact = await getBackupArtifact(decodeURIComponent(artifactId));
    if (!artifact || !artifact.organizationId || (artifact.scope !== "ORGANIZATION" && artifact.scope !== "LEGACY_SINGLETON")) {
      return NextResponse.json({ error: "El artefacto no está disponible para una organización." }, { status: 404 });
    }
    const result = await getBackupDownload(artifact.filename, artifact.pathname);
    if (result?.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: "El respaldo ya no se encuentra disponible." }, { status: 404 });
    }
    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${artifact.filename}"`,
      "Content-Type": "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    if (result.blob.size !== null) headers.set("Content-Length", String(result.blob.size));
    return new NextResponse(result.stream, { status: 200, headers });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    logError("api.backups.artifact-download", error);
    return NextResponse.json({ error: "No se pudo descargar el respaldo. Intenta de nuevo." }, { status: 500 });
  }
}
