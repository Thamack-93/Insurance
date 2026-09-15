import type { BackupManifest } from "@/lib/backup-logic";

export const GLOBAL_RESTORE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type RestoreBackupCatalogEntry = {
  status: string;
  scope: string;
  organizationId: string | null;
  pathname: string;
};

export function assertRestorableGlobalBackup(input: {
  manifest: BackupManifest;
  catalogEntry: RestoreBackupCatalogEntry | null;
  now?: Date;
  maxAgeMs?: number;
}) {
  const { manifest, catalogEntry } = input;
  if (!catalogEntry) throw new Error("El backup no tiene un artifact catalogado en la base origen.");
  if (catalogEntry.status !== "VERIFIED") throw new Error("El artifact del backup no está en estado VERIFIED.");
  if (catalogEntry.scope !== "PLATFORM" || catalogEntry.organizationId !== null) {
    throw new Error("El backup seleccionado no es un respaldo global de la plataforma.");
  }
  if (catalogEntry.pathname !== manifest.payload.pathname) {
    throw new Error("El artifact y el manifiesto no apuntan al mismo payload.");
  }
  // Format-1 global manifests created before scope was written omit the
  // optional field. The catalog is authoritative for their platform scope;
  // new manifests always include scope: PLATFORM.
  const legacyGlobalManifest = manifest.version === 1 && manifest.scope === undefined;
  if (manifest.scope !== "PLATFORM" && !legacyGlobalManifest) {
    throw new Error("El manifiesto no declara scope PLATFORM.");
  }
  if (manifest.demoExclusion?.policy !== "EXCLUDE_DEMO") {
    throw new Error("El manifiesto global no declara EXCLUDE_DEMO.");
  }
  const createdAt = Date.parse(manifest.createdAt);
  if (!Number.isFinite(createdAt)) throw new Error("La fecha de creación del backup no es válida.");
  const now = (input.now ?? new Date()).getTime();
  const maxAgeMs = input.maxAgeMs ?? GLOBAL_RESTORE_MAX_AGE_MS;
  if (createdAt > now) throw new Error("El backup tiene una fecha futura y no puede certificarse.");
  if (now - createdAt > maxAgeMs) throw new Error("El backup global tiene más de siete días.");
  return { ok: true as const, createdAt: new Date(createdAt).toISOString(), ageMs: now - createdAt };
}
