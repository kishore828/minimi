/**
 * Typed application errors. `expose` controls whether the message is safe to
 * show to the end user; internal errors are masked to avoid leaking details.
 */

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "MISSING_API_KEY"
  | "CONFIG_ERROR"
  | "LLM_ERROR"
  | "SEARCH_ERROR"
  | "TIMEOUT"
  | "ABORTED"
  | "INTERNAL";

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  RATE_LIMITED: 429,
  NOT_FOUND: 404,
  MISSING_API_KEY: 503,
  CONFIG_ERROR: 500,
  LLM_ERROR: 502,
  SEARCH_ERROR: 502,
  TIMEOUT: 504,
  ABORTED: 499,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  cause?: unknown;
  expose?: boolean;
  status?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly expose: boolean;
  readonly status: number;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.expose = options.expose ?? code !== "INTERNAL";
    this.status = options.status ?? DEFAULT_STATUS[code];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Convert any thrown value into a safe, user-presentable error. */
export function toPublicError(error: unknown): { code: ErrorCode; message: string; status: number } {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.expose ? error.message : "Something went wrong while handling the request.",
      status: error.status,
    };
  }
  return {
    code: "INTERNAL",
    message: "Something went wrong while handling the request.",
    status: 500,
  };
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    const name = error.name;
    return name === "AbortError" || name === "TimeoutError";
  }
  return false;
}
