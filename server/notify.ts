import { schema, type Db } from "./db";
import { newId } from "./ids";

export async function notify(database: Db, input: { orgId: string; kind: string; title: string; body?: string; href?: string }) {
  await database.insert(schema.notifications).values({ id: newId("ntf_"), orgId: input.orgId, kind: input.kind, title: input.title, body: input.body ?? "", href: input.href ?? "" });
}
