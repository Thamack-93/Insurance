import { OperationTimeoutError, withOperationTimeout } from "@/lib/operation-timeout";

export const PDF_CAPTURE_ANALYSIS_TIMEOUT_MS = 60_000;
export const PDF_CAPTURE_UPLOAD_TIMEOUT_MS = 30_000;

export { withOperationTimeout };

export async function fetchPdfCaptureWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const request = fetch(input, { ...init, signal: controller.signal });
    const deadline = new Promise<Response>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new OperationTimeoutError(timeoutMessage));
      }, timeoutMs);
    });
    return await Promise.race([request, deadline]);
  } catch (error) {
    if (timedOut) throw new OperationTimeoutError(timeoutMessage);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
