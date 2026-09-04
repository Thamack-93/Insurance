export function isVercelDeployment() {
  return process.env.VERCEL === "1";
}

export function hasHostedDatabase() {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && /^postgres(ql)?:\/\//i.test(url);
}

export function areDocumentFilesEnabled() {
  if (process.env.PLATFORM_UPLOADS_ENABLED?.trim() === "0") return false;
  if (isVercelDeployment()) return process.env.NEXT_PUBLIC_DOCUMENT_FILES_ENABLED === "1";
  return process.env.ENABLE_DOCUMENT_FILES !== "false";
}
