export type PdfTextExtractionOptions = {
  timeoutMs?: number;
  signal?: AbortSignal;
};

export const DEFAULT_BROWSER_PDF_TEXT_EXTRACTION_TIMEOUT_MS = 12_000;
export const DEFAULT_SERVER_PDF_TEXT_EXTRACTION_TIMEOUT_MS = 20_000;

export class PdfTextExtractionTimeoutError extends Error {
  readonly code = "PDF_TEXT_EXTRACTION_TIMEOUT";

  constructor() {
    super("La extracción de texto del PDF excedió el tiempo permitido.");
    this.name = "PdfTextExtractionTimeoutError";
  }
}

export class PdfTextExtractionAbortedError extends Error {
  readonly code = "PDF_TEXT_EXTRACTION_ABORTED";

  constructor() {
    super("La extracción de texto del PDF fue cancelada.");
    this.name = "PdfTextExtractionAbortedError";
  }
}

export function createPdfTextExtractionControl(options: PdfTextExtractionOptions = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SERVER_PDF_TEXT_EXTRACTION_TIMEOUT_MS;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();

  if (options.signal?.aborted) {
    abortFromCaller();
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  return {
    signal: controller.signal,
    error() {
      return timedOut ? new PdfTextExtractionTimeoutError() : new PdfTextExtractionAbortedError();
    },
    cleanup() {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

export function abortablePdfPromise<T>(promise: Promise<T>, control: ReturnType<typeof createPdfTextExtractionControl>) {
  if (control.signal.aborted) return Promise.reject(control.error());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(control.error());
    control.signal.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        control.signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        control.signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
