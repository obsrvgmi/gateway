import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getAddress, isAddress, recoverMessageAddress, type Hex } from "viem";
import { audit } from "../audit";
import { db, schema } from "../db";
import { sendEmail } from "../email";
import { env } from "../env";
import { badRequest, conflict } from "../http/errors";
import { newId } from "../ids";
import { log } from "../log";
import { emit } from "../outbox";
import { heldAmounts, inFlightAmounts, readBalances } from "./availability";
import { assertNotScreened } from "./guards";
import { assertHasWallet, loadOrg } from "./payouts";

const CHALLENGE_TTL_MS = 15 * 60_000;

type Action = "settlement" | "destination";

const tag = (body: string) => createHmac("sha256", env().SECRET_KEY).update(`wallet-challenge:${body}`).digest("hex").slice(0, 32);

function challengeBody(action: Action, orgId: string, address: string, issuedAt: string) {
  const line = action === "settlement" ? `Make ${address} the settlement wallet` : `Allow payouts to ${address}`;
  return `Gateway account action\n\n${line}\nWorkspace: ${orgId}\nIssued: ${issuedAt}`;
}

/** A message for a wallet to sign. Tagged, so only one we issued, recently, for this exact change is accepted. */
export function issueChallenge(action: Action, orgId: string, address: string, now = new Date()) {
  const body = challengeBody(action, orgId, address, now.toISOString());
  return `${body}\nCode: ${tag(body)}`;
}

function assertChallenge(message: string, action: Action, orgId: string, address: string) {
  const issued = /^Issued: (.+)$/m.exec(message)?.[1];
  const code = /^Code: ([0-9a-f]{32})$/m.exec(message)?.[1];
  if (!issued || !code) throw badRequest("That signed message isn't valid.", "challenge_invalid");
  const body = challengeBody(action, orgId, address, issued);
  if (message !== `${body}\nCode: ${tag(body)}` || code !== tag(body)) throw badRequest("That signed message isn't valid.", "challenge_invalid");
  const age = Date.now() - Date.parse(issued);
  if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) throw badRequest("That signed message has expired. Please try again.", "challenge_expired");
}

export async function recoverSigner(message: string, signature: string) {
  try {
    return (await recoverMessageAddress({ message, signature: signature as Hex })).toLowerCase();
  } catch {
    throw badRequest("That signature isn't valid.", "signature_invalid");
  }
}

export function parseEvmWallet(value: string) {
  const trimmed = value.trim();
  if (!isAddress(trimmed)) throw badRequest("Enter an EVM wallet address.", "wallet_invalid");
  return getAddress(trimmed).toLowerCase();
}

async function owners(orgId: string) {
  return db().select({ email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.role, "owner")));
}

/**
 * Sets the settlement wallet, which decides where all future money goes. The new wallet must sign, and
 * an existing wallet must also sign: an email-based session alone can never redirect funds, and there
 * is no timed fallback an attacker could wait out. A merchant who lost their key goes through support.
 */
export async function setSettlementWallet(input: { orgId: string; userId: string; wallet: string; message: string; newSignature: string; currentSignature?: string | null; ip?: string | null }) {
  const wallet = parseEvmWallet(input.wallet);
  const org = await loadOrg(input.orgId);
  assertChallenge(input.message, "settlement", org.id, wallet);
  if ((await recoverSigner(input.message, input.newSignature)) !== wallet) throw badRequest("Sign with the wallet you're connecting.", "signature_wrong_wallet");
  await assertNotScreened([wallet], { orgId: org.id, action: "wallet", ip: input.ip });
  if (org.walletAddress === wallet) return org;

  if (org.walletAddress) {
    if (!input.currentSignature) throw conflict("Sign with your current settlement wallet too.", "current_signature_required");
    if ((await recoverSigner(input.message, input.currentSignature)) !== org.walletAddress) throw badRequest("Sign with your current settlement wallet.", "signature_wrong_wallet");
    // Balances belong to a key, so this wallet's balance would vanish from view, and money on its way
    // would land where nothing here looks.
    const balances = await readBalances(org.walletAddress);
    const [held, moving] = await Promise.all([heldAmounts(org), inFlightAmounts(org.id)]);
    if ([...balances.values()].some((amount) => amount > 0n) || held.size > 0 || moving.size > 0) throw conflict("Pay out this wallet's balance before changing it.", "balance_not_empty");
    const arriving = await db().select({ id: schema.payments.id }).from(schema.payments).where(and(eq(schema.payments.orgId, org.id), eq(schema.payments.recipient, org.walletAddress), inArray(schema.payments.state, ["deposit_seen", "incomplete_deposit", "processing"]))).limit(1);
    if (arriving.length) throw conflict("Wait for payments in progress to land before changing your wallet.", "payments_in_flight");
  }

  const updated = await db().transaction(async (tx) => {
    const [row] = await tx.update(schema.organizations).set({ walletAddress: wallet, walletVerifiedAt: new Date() }).where(eq(schema.organizations.id, org.id)).returning();
    await tx.insert(schema.walletChanges).values({ id: newId("wch_"), orgId: org.id, fromWallet: org.walletAddress, toWallet: wallet, requestedBy: input.userId, message: input.message, newWalletSignature: input.newSignature, currentWalletSignature: input.currentSignature ?? null });
    // Its own wallet is always a valid destination, and is the natural default.
    const existing = await tx.select({ id: schema.destinations.id }).from(schema.destinations).where(and(eq(schema.destinations.orgId, org.id), eq(schema.destinations.address, wallet), isNull(schema.destinations.removedAt))).limit(1);
    let destinationId = existing[0]?.id;
    if (!destinationId) {
      destinationId = newId("dst_");
      await tx.insert(schema.destinations).values({ id: destinationId, orgId: org.id, label: "Settlement wallet", address: wallet });
    }
    if (!org.defaultDestinationId) await tx.update(schema.organizations).set({ defaultDestinationId: destinationId }).where(eq(schema.organizations.id, org.id));
    await audit(tx, { orgId: org.id, actorType: "user", actorId: input.userId, action: "wallet.set", target: wallet, detail: { from: org.walletAddress }, ip: input.ip });
    await emit(tx, org.id, "alert.wallet_changed", { from: org.walletAddress, to: wallet });
    return row;
  });

  const recipients = await owners(org.id);
  await Promise.all(recipients.map(({ email }) => sendEmail({ to: email, subject: "Your settlement wallet changed", text: `The settlement wallet for ${org.businessName} is now ${wallet}${org.walletAddress ? `, replacing ${org.walletAddress}` : ""}.\n\nAll new payments go to this wallet. If you didn't do this, contact support immediately.` }).catch((error) => log("error", "wallet change email failed", { error }))));
  return updated;
}

/** A destination other than the wallet itself needs the wallet's signature. */
export async function addDestination(input: { orgId: string; userId: string; id?: string; label: string; address: string; message?: string | null; signature?: string | null; ip?: string | null }) {
  const org = await loadOrg(input.orgId);
  assertHasWallet(org);
  const address = input.address.trim();
  await assertNotScreened([address], { orgId: org.id, action: "destination", ip: input.ip });
  const isOwnWallet = address.toLowerCase() === org.walletAddress;
  if (!isOwnWallet) {
    if (!input.message || !input.signature) throw conflict("Confirm this destination with your settlement wallet.", "signature_required");
    assertChallenge(input.message, "destination", org.id, address);
    if ((await recoverSigner(input.message, input.signature)) !== org.walletAddress) throw badRequest("Sign with your settlement wallet.", "signature_wrong_wallet");
  }
  const id = input.id ?? newId("dst_");
  const [row] = await db().insert(schema.destinations).values({ id, orgId: org.id, label: input.label, address, message: input.message ?? null, signature: input.signature ?? null }).returning();
  await audit(db(), { orgId: org.id, actorType: "user", actorId: input.userId, action: "destination.added", target: address, ip: input.ip });
  await emit(db(), org.id, "alert.destination_added", { label: input.label, address });
  return row;
}
