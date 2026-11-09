import "server-only";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { audit } from "./audit";
import { db, schema } from "./db";
import { conflict, notFound } from "./http/errors";
import { newId } from "./ids";
import { emit } from "./outbox";
import type { linkCreate, linkPatch, widgetCreate, widgetPatch } from "./schemas";
import { toLink, toWidget } from "./state";

const usd = (value: number | null | undefined) => (value === null || value === undefined ? value : value.toFixed(2));
const when = (value: string | null | undefined) => (value === undefined ? undefined : value === null ? null : new Date(value));

interface Actor {
  orgId: string;
  actorType: "user" | "api_key";
  actorId: string;
  ip?: string | null;
}

/** A repeat with the same id restores a deleted link, which is how Undo works. Another workspace's id is refused. */
export async function createLink(input: z.output<typeof linkCreate>, actor: Actor) {
  const id = input.id ?? newId("lnk_");
  const [existing] = await db().select().from(schema.paymentLinks).where(eq(schema.paymentLinks.id, id)).limit(1);
  if (existing && existing.orgId !== actor.orgId) throw conflict("That id is already in use.");
  const values = { title: input.title, description: input.description, amountUsd: usd(input.amount), receiveAsset: input.receiveAsset, status: input.status, expiresAt: when(input.expiresAt), successUrl: input.successUrl };
  // Left out means "unchanged" on a re-save, and the default on a new link.
  const extras = { ...(input.metadata !== undefined && { metadata: input.metadata }), ...(input.singleUse !== undefined && { singleUse: input.singleUse }), ...(input.publicStats !== undefined && { publicStats: input.publicStats }) };
  if (existing) {
    const [row] = await db().update(schema.paymentLinks).set({ ...values, ...extras, deletedAt: null }).where(eq(schema.paymentLinks.id, id)).returning();
    return toLink(row);
  }
  return db().transaction(async (tx) => {
    const [row] = await tx.insert(schema.paymentLinks).values({ id, orgId: actor.orgId, ...values, ...extras }).returning();
    await audit(tx, { orgId: actor.orgId, actorType: actor.actorType, actorId: actor.actorId, action: "link.created", target: id, ip: actor.ip });
    await emit(tx, actor.orgId, "link.created", { id, title: row.title, amount_usd: input.amount, receive_asset: input.receiveAsset });
    return toLink(row);
  });
}

export async function updateLink(id: string, patch: z.output<typeof linkPatch>, actor: Actor) {
  const [row] = await db()
    .update(schema.paymentLinks)
    .set({
      ...(patch.title !== undefined && { title: patch.title }),
      ...(patch.description !== undefined && { description: patch.description }),
      ...(patch.amount !== undefined && { amountUsd: usd(patch.amount) }),
      ...(patch.receiveAsset !== undefined && { receiveAsset: patch.receiveAsset }),
      ...(patch.status !== undefined && { status: patch.status }),
      ...(patch.expiresAt !== undefined && { expiresAt: when(patch.expiresAt) }),
      ...(patch.successUrl !== undefined && { successUrl: patch.successUrl }),
      ...(patch.metadata !== undefined && { metadata: patch.metadata }),
      ...(patch.singleUse !== undefined && { singleUse: patch.singleUse }),
      ...(patch.publicStats !== undefined && { publicStats: patch.publicStats }),
    })
    .where(and(eq(schema.paymentLinks.id, id), eq(schema.paymentLinks.orgId, actor.orgId)))
    .returning();
  if (!row) throw notFound();
  await audit(db(), { orgId: actor.orgId, actorType: actor.actorType, actorId: actor.actorId, action: "link.updated", target: id, ip: actor.ip });
  return toLink(row);
}

export async function deleteLink(id: string, actor: Actor) {
  const [row] = await db().update(schema.paymentLinks).set({ deletedAt: new Date() }).where(and(eq(schema.paymentLinks.id, id), eq(schema.paymentLinks.orgId, actor.orgId))).returning({ id: schema.paymentLinks.id });
  if (!row) throw notFound();
  await audit(db(), { orgId: actor.orgId, actorType: actor.actorType, actorId: actor.actorId, action: "link.deleted", target: id, ip: actor.ip });
}

export async function createWidget(input: z.output<typeof widgetCreate>, actor: Actor) {
  const id = input.id ?? newId("wgt_");
  const [existing] = await db().select().from(schema.widgets).where(eq(schema.widgets.id, id)).limit(1);
  if (existing && existing.orgId !== actor.orgId) throw conflict("That id is already in use.");
  const { id: _id, amount, ...fields } = input;
  void _id;
  const values = { ...fields, amountUsd: usd(amount) };
  if (existing) {
    const [row] = await db().update(schema.widgets).set({ ...values, deletedAt: null }).where(eq(schema.widgets.id, id)).returning();
    return toWidget(row);
  }
  const [row] = await db().insert(schema.widgets).values({ id, orgId: actor.orgId, ...values }).returning();
  await audit(db(), { orgId: actor.orgId, actorType: actor.actorType, actorId: actor.actorId, action: "widget.created", target: id, ip: actor.ip });
  return toWidget(row);
}

export async function updateWidget(id: string, patch: z.output<typeof widgetPatch>, actor: Actor) {
  const { amount, ...fields } = patch;
  const [row] = await db()
    .update(schema.widgets)
    .set({ ...fields, ...(amount !== undefined && { amountUsd: usd(amount) }) })
    .where(and(eq(schema.widgets.id, id), eq(schema.widgets.orgId, actor.orgId)))
    .returning();
  if (!row) throw notFound();
  await audit(db(), { orgId: actor.orgId, actorType: actor.actorType, actorId: actor.actorId, action: "widget.updated", target: id, ip: actor.ip });
  return toWidget(row);
}

export async function deleteWidget(id: string, actor: Actor) {
  const [row] = await db().update(schema.widgets).set({ deletedAt: new Date() }).where(and(eq(schema.widgets.id, id), eq(schema.widgets.orgId, actor.orgId))).returning({ id: schema.widgets.id });
  if (!row) throw notFound();
  await audit(db(), { orgId: actor.orgId, actorType: actor.actorType, actorId: actor.actorId, action: "widget.deleted", target: id, ip: actor.ip });
}
