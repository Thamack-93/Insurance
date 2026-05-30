import path from "node:path";

export const dataDir = path.join(process.cwd(), "data");
export const documentsDir = path.join(dataDir, "documents");
export const backupsDir = path.join(dataDir, "backups");
export const exportsDir = path.join(dataDir, "exports");
export const databasePath = path.join(dataDir, "pg.sqlite");

export function assertSafeDocumentPath(filePath: string) {
  const resolved = path.resolve(filePath);
  const allowed = path.resolve(documentsDir);

  if (!resolved.startsWith(allowed)) {
    throw new Error("Document path must stay within the document store.");
  }

  return resolved;
}

export function assertSafeBackupPath(filename: string) {
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error("Backup path must stay within the backup store.");
  }

  if (!filename.endsWith(".sqlite")) {
    throw new Error("Backup path must stay within the backup store.");
  }

  const resolved = path.resolve(backupsDir, filename);
  const allowed = path.resolve(backupsDir);

  if (!resolved.startsWith(allowed + path.sep)) {
    throw new Error("Backup path must stay within the backup store.");
  }

  return resolved;
}
