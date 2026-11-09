/** Browser calls to our own API. A failed call throws, with the server's message safe to show. */
/**
 * The server looked at the request and said no. Anything else, a lost response or a server error, leaves
 * the outcome unknown, and for money that means "it may have gone", never "it didn't".
 */
export const isRefusal = (error: unknown) => error instanceof ApiError && error.status >= 400 && error.status < 500;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { ...(init.body === undefined ? {} : { "Content-Type": "application/json" }), ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    throw new ApiError(0, "network", "We couldn't reach the server. Check your connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as (T & { error?: { code: string; message: string } }) | null;
  if (!response.ok) {
    const { code = "error", message = "Something went wrong. Please try again.", ...extra } = (data?.error ?? {}) as { code?: string; message?: string } & Record<string, unknown>;
    throw new ApiError(response.status, code, message, extra);
  }
  return data as T;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong. Please try again.");
