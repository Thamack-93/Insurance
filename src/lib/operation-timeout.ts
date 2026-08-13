export class OperationTimeoutError extends Error {
  readonly code = "OPERATION_TIMEOUT";

  constructor(message: string) {
    super(message);
    this.name = "OperationTimeoutError";
  }
}

export function withOperationTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new OperationTimeoutError(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}
