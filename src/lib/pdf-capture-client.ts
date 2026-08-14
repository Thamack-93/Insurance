import { upload } from "@vercel/blob/client";
import { OperationTimeoutError, withOperationTimeout } from "@/lib/operation-timeout";

export const PDF_CAPTURE_ANALYSIS_TIMEOUT_MS = 60_000;
export const PDF_CAPTURE_UPLOAD_ATTEMPT_TIMEOUT_MS = 20_000;
export const PDF_CAPTURE_UPLOAD_TOTAL_TIMEOUT_MS = 45_000;
export const PDF_CAPTURE_UPLOAD_MAX_ATTEMPTS = 2;
export const PDF_CAPTURE_UPLOAD_TIMEOUT_MS = PDF_CAPTURE_UPLOAD_TOTAL_TIMEOUT_MS;

export type PdfCaptureUploadStatus = "pending" | "uploading" | "retained" | "unavailable" | "retryable";

export type PdfCaptureUploadProgress = {
  loaded: number;
  total: number;
  percentage: number;
  attempt: number;
  maxAttempts: number;
};

export type PdfCaptureUploadErrorCode =
  | "UPLOAD_TIMEOUT"
  | "UPLOAD_NETWORK"
  | "BLOB_NOT_CONFIGURED"
  | "UPLOAD_UNAUTHORIZED"
  | "UPLOAD_RATE_LIMITED"
  | "UPLOAD_REJECTED"
  | "UPLOAD_SERVER_ERROR"
  | "UPLOAD_CANCELLED"
  | "UPLOAD_UNKNOWN";

export class PdfCaptureUploadError extends Error {
  readonly code: PdfCaptureUploadErrorCode;
  readonly retryable: boolean;
  readonly attempts: number;

  constructor(message: string, options: { code: PdfCaptureUploadErrorCode; retryable: boolean; attempts: number }) {
    super(message);
    this.name = "PdfCaptureUploadError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.attempts = options.attempts;
  }
}

type UploadFunction = typeof upload;

type UploadPdfWithRetryOptions = {
  pathname: string;
  file: File;
  handleUploadUrl: string;
  clientPayload: string;
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxAttempts?: number;
  uploadFn?: UploadFunction;
  onProgress?: (progress: PdfCaptureUploadProgress) => void;
  signal?: AbortSignal;
};

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  const status = candidate.statusCode ?? candidate.status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "");
}

function classifyUploadError(error: unknown, timedOut: boolean): { code: PdfCaptureUploadErrorCode; retryable: boolean; message: string } {
  if (timedOut || (error instanceof Error && error.name === "AbortError")) {
    return { code: "UPLOAD_TIMEOUT", retryable: true, message: "La subida temporal superó el tiempo límite." };
  }

  const status = getErrorStatus(error);
  const text = errorText(error).toLowerCase();
  if (/blob_not_configured|blob read write token|read_write_token|not configured/.test(text)) {
    return { code: "BLOB_NOT_CONFIGURED", retryable: false, message: "El almacenamiento temporal de PDFs no está configurado en el servidor." };
  }
  if (status === 401 || status === 403 || /unauthor|forbidden|permission|token/.test(text)) {
    return { code: "UPLOAD_UNAUTHORIZED", retryable: false, message: "La subida temporal no fue autorizada. Revisa la sesión y la configuración de Blob." };
  }
  if (status === 413 || /too large|maximum size|size limit|payload too large/.test(text)) {
    return { code: "UPLOAD_REJECTED", retryable: false, message: "El PDF supera el tamaño permitido por el almacenamiento temporal." };
  }
  if (status === 429 || /rate limit|too many requests/.test(text)) {
    return { code: "UPLOAD_RATE_LIMITED", retryable: false, message: "Se alcanzó el límite de subidas temporales. Espera unos minutos e inténtalo de nuevo." };
  }
  if (status != null && status >= 400 && status < 500) {
    return { code: "UPLOAD_REJECTED", retryable: false, message: "El almacenamiento temporal rechazó este PDF." };
  }
  if (status != null && status >= 500) {
    return { code: "UPLOAD_SERVER_ERROR", retryable: true, message: "El almacenamiento temporal respondió con un error. Inténtalo de nuevo." };
  }
  if (error instanceof TypeError || /network|fetch|connection|failed to fetch|load failed/.test(text)) {
    return { code: "UPLOAD_NETWORK", retryable: true, message: "No se pudo conectar con el almacenamiento temporal." };
  }
  return { code: "UPLOAD_UNKNOWN", retryable: false, message: "No se pudo conservar temporalmente el PDF." };
}

function pathnameForAttempt(pathname: string, operationId: string, attempt: number) {
  const extensionIndex = pathname.toLowerCase().lastIndexOf(".pdf");
  if (extensionIndex < 0) return `${pathname}-${operationId}-${attempt}`;
  return `${pathname.slice(0, extensionIndex)}-${operationId}-${attempt}${pathname.slice(extensionIndex)}`;
}

async function uploadOnce(
  uploadFn: UploadFunction,
  pathname: string,
  file: File,
  options: {
    handleUploadUrl: string;
    clientPayload: string;
    timeoutMs: number;
    attempt: number;
    maxAttempts: number;
    onProgress?: (progress: PdfCaptureUploadProgress) => void;
    signal?: AbortSignal;
  },
) {
  const controller = new AbortController();
  if (options.signal?.aborted) {
    throw new PdfCaptureUploadError("La subida temporal fue cancelada.", { code: "UPLOAD_CANCELLED", retryable: false, attempts: options.attempt });
  }
  const abortFromParent = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromParent, { once: true });
  let rejectCancellation: ((reason?: unknown) => void) | undefined;
  const cancellation = options.signal
    ? new Promise<never>((_, reject) => { rejectCancellation = reject; })
    : null;
  const rejectFromParent = () => rejectCancellation?.(new PdfCaptureUploadError("La subida temporal fue cancelada.", { code: "UPLOAD_CANCELLED", retryable: false, attempts: options.attempt }));
  options.signal?.addEventListener("abort", rejectFromParent, { once: true });
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new PdfCaptureUploadError("La subida temporal superó el tiempo límite.", {
          code: "UPLOAD_TIMEOUT",
          retryable: true,
          attempts: options.attempt,
        }));
      }, options.timeoutMs);
    });
    const result = await Promise.race([
      uploadFn(pathname, file, {
        access: "private",
        handleUploadUrl: options.handleUploadUrl,
        contentType: "application/pdf",
        multipart: file.size > 5 * 1024 * 1024,
        clientPayload: options.clientPayload,
        abortSignal: controller.signal,
        onUploadProgress: (progress) => options.onProgress?.({ ...progress, attempt: options.attempt, maxAttempts: options.maxAttempts }),
      }),
      timeout,
      ...(cancellation ? [cancellation] : []),
    ]);
    return result;
  } catch (error) {
    if (error instanceof PdfCaptureUploadError) throw error;
    if (options.signal?.aborted) {
      throw new PdfCaptureUploadError("La subida temporal fue cancelada.", { code: "UPLOAD_CANCELLED", retryable: false, attempts: options.attempt });
    }
    const classified = classifyUploadError(error, timedOut);
    throw new PdfCaptureUploadError(classified.message, {
      code: classified.code,
      retryable: classified.retryable,
      attempts: options.attempt,
    });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abortFromParent);
    options.signal?.removeEventListener("abort", rejectFromParent);
    controller.abort();
  }
}

export async function uploadPdfWithRetry(options: UploadPdfWithRetryOptions): Promise<Awaited<ReturnType<UploadFunction>> & { attempts: number }> {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? PDF_CAPTURE_UPLOAD_ATTEMPT_TIMEOUT_MS;
  const totalTimeoutMs = options.totalTimeoutMs ?? PDF_CAPTURE_UPLOAD_TOTAL_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? PDF_CAPTURE_UPLOAD_MAX_ATTEMPTS;
  const uploadFn = options.uploadFn ?? upload;
  const operationId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
    : `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  let lastError: PdfCaptureUploadError | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new PdfCaptureUploadError("La subida temporal fue cancelada.", { code: "UPLOAD_CANCELLED", retryable: false, attempts: attempt - 1 });
    }
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs <= 0) break;
    const timeoutMs = Math.min(attemptTimeoutMs, remainingMs);
    options.onProgress?.({ loaded: 0, total: options.file.size, percentage: 0, attempt, maxAttempts });
    try {
      const result = await uploadOnce(uploadFn, pathnameForAttempt(options.pathname, operationId, attempt), options.file, {
        handleUploadUrl: options.handleUploadUrl,
        clientPayload: options.clientPayload,
        timeoutMs,
        attempt,
        maxAttempts,
        onProgress: options.onProgress,
        signal: options.signal,
      });
      options.onProgress?.({ loaded: options.file.size, total: options.file.size, percentage: 100, attempt, maxAttempts });
      return { ...result, attempts: attempt };
    } catch (error) {
      lastError = error instanceof PdfCaptureUploadError
        ? error
        : new PdfCaptureUploadError("No se pudo conservar temporalmente el PDF.", { code: "UPLOAD_UNKNOWN", retryable: false, attempts: attempt });
      if (!lastError.retryable || lastError.code === "UPLOAD_CANCELLED" || attempt >= maxAttempts) break;
      const delayMs = Math.min(1_500, 500 * attempt);
      const remainingAfterFailure = totalTimeoutMs - (Date.now() - startedAt);
      if (remainingAfterFailure <= delayMs) break;
      await new Promise<void>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          options.signal?.removeEventListener("abort", onAbort);
          resolve();
        }, delayMs);
        const onAbort = () => {
          clearTimeout(timeoutId);
          options.signal?.removeEventListener("abort", onAbort);
          reject(new PdfCaptureUploadError("La subida temporal fue cancelada.", { code: "UPLOAD_CANCELLED", retryable: false, attempts: attempt }));
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
  }

  throw lastError ?? new PdfCaptureUploadError("La subida temporal superó el tiempo límite.", {
    code: "UPLOAD_TIMEOUT",
    retryable: true,
    attempts: maxAttempts,
  });
}

export { withOperationTimeout };

export async function fetchPdfCaptureWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
  signal?: AbortSignal,
) {
  const controller = new AbortController();
  let abortFromParent: (() => void) | undefined;
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
    abortFromParent = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", abortFromParent, { once: true });
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
    if (abortFromParent) signal?.removeEventListener("abort", abortFromParent);
    // Do not abort a successful fetch here: callers still need to consume
    // response.json()/response.text() after this helper returns the Response.
    // Abort only when the request was cancelled or timed out.
    if (timedOut || signal?.aborted) controller.abort();
  }
}
