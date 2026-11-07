export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request", extra?: Record<string, unknown>) => new HttpError(400, code, message, extra);
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to do that.") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);
export const conflict = (message: string, code = "conflict", extra?: Record<string, unknown>) => new HttpError(409, code, message, extra);
export const tooMany = (message = "Too many requests. Try again shortly.") => new HttpError(429, "rate_limited", message);
export const unavailable = (message: string, code = "unavailable") => new HttpError(503, code, message);
