export function resolveReceiptAuxiliary<T>(
  result: PromiseSettledResult<T>,
  fallback: T,
  onRejected: (reason: unknown) => void,
): T {
  if (result.status === "fulfilled") return result.value;
  onRejected(result.reason);
  return fallback;
}

export function isReceiptQualitasEnabled(
  capability: { enabled: boolean } | null,
  paymentLinkEnabled: boolean,
): boolean {
  return Boolean(capability?.enabled && paymentLinkEnabled);
}
