export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal"
  | "unavailable";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details: Record<string, unknown> | undefined;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(m: string, d?: Record<string, unknown>) {
    super("bad_request", m, d);
  }
}

export class UnauthorizedError extends AppError {
  constructor(m = "unauthorized") {
    super("unauthorized", m);
  }
}

export class ForbiddenError extends AppError {
  constructor(m = "forbidden") {
    super("forbidden", m);
  }
}

export class NotFoundError extends AppError {
  constructor(m: string, d?: Record<string, unknown>) {
    super("not_found", m, d);
  }
}

export class ConflictError extends AppError {
  constructor(m: string, d?: Record<string, unknown>) {
    super("conflict", m, d);
  }
}

export class RateLimitedError extends AppError {
  constructor(m = "rate limited") {
    super("rate_limited", m);
  }
}

export class InternalError extends AppError {
  constructor(m = "internal error") {
    super("internal", m);
  }
}

export class UnavailableError extends AppError {
  constructor(m = "service unavailable") {
    super("unavailable", m);
  }
}

const statusMap: Record<ErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
};

export function toHttpStatus(e: unknown): number {
  if (e instanceof AppError) {
    return statusMap[e.code];
  }
  return 500;
}
