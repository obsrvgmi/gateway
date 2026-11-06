type Level = "info" | "warn" | "error";

const REDACT = /(token|secret|signature|authorization|cookie|password|api[-_]?key)/i;

function clean(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value instanceof Error ? value.message : value;
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, REDACT.test(key) ? "[redacted]" : clean(item, depth + 1)]));
}

/** One JSON line per event. Keys that look like secrets are redacted whatever the caller passes. */
export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, msg, at: new Date().toISOString(), ...(clean(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
