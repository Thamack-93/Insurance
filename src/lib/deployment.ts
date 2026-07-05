export function isVercelDeployment() {
  return process.env.VERCEL === "1";
}

export function hasHostedDatabase() {
  const url = process.env.DATABASE_URL?.trim();
  return !!url && /^postgres(ql)?:\/\//i.test(url);
}

export function areDocumentFilesEnabled() {
  return !isVercelDeployment() && process.env.ENABLE_DOCUMENT_FILES !== "false";
}
