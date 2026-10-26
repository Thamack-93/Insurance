type ReceiptRead = () => unknown;

type SettledReceiptReads<T extends readonly ReceiptRead[]> = {
  [K in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[K]>>>;
};

/**
 * Run reads in order while preserving Promise.allSettled-style failure handling.
 * Tenant transactions share a PostgreSQL client, which must not execute queries concurrently.
 */
export async function settleReceiptReadsSequentially<const T extends readonly ReceiptRead[]>(
  reads: T,
): Promise<SettledReceiptReads<T>> {
  const results: PromiseSettledResult<unknown>[] = [];
  for (const read of reads) {
    try {
      results.push({ status: "fulfilled", value: await read() });
    } catch (reason) {
      results.push({ status: "rejected", reason });
    }
  }
  return results as SettledReceiptReads<T>;
}

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
