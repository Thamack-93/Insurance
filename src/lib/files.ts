import path from "node:path";

export const dataDir = path.join(process.cwd(), "data");
export const documentsDir = path.join(dataDir, "documents");
export const exportsDir = path.join(dataDir, "exports");

export function assertSafeDocumentPath(filePath: string) {
  const resolved = path.resolve(filePath);
  const allowed = path.resolve(documentsDir);

  if (!resolved.startsWith(allowed)) {
    throw new Error("Document path must stay within the document store.");
  }

  return resolved;
}
