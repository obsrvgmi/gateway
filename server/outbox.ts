import { schema, type Db } from "./db";

/** Called inside the transaction that made the change, so an event exists only if the change does. */
export async function emit(database: Db, orgId: string, type: string, payload: Record<string, unknown>) {
  await database.insert(schema.outbox).values({ orgId, type, payload });
}
