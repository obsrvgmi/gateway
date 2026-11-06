import type { Db } from "./db";
import { schema } from "./db";

export interface AuditEntry {
  orgId: string | null;
  actorType: "user" | "api_key" | "system" | "customer";
  actorId?: string | null;
  action: string;
  target?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

/** Pass the open transaction, so the record and the change it describes commit together. */
export async function audit(database: Db, entry: AuditEntry) {
  await database.insert(schema.auditLog).values({
    orgId: entry.orgId,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    target: entry.target ?? null,
    detail: entry.detail ?? null,
    ip: entry.ip ?? null,
  });
}
