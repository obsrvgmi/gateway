#!/usr/bin/env node
/**
 * Deletes each money and access guard, one at a time, and checks that a test fails. A guard no test
 * notices might as well not exist. Run on a clean tree, or in a worktree: it edits files as it goes.
 *
 *   node scripts/mutate-guards.mjs                 all of them
 *   node scripts/mutate-guards.mjs refund wallet   only mutants whose name contains a word
 *
 * A "find" that no longer matches is reported as STALE and counts as a failure, so this list can't rot.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const G = "server/payments/guards.ts";
const C = "server/payments/checkout.ts";
const I = "lib/intents.ts";
const F = "server/payments/intent-flow.ts";
const P = "server/payments/payouts.ts";
const R = "server/payments/refunds.ts";
const W = "server/payments/wallet.ts";
const SM = "server/payments/state-machine.ts";
const S = "lib/sign-intent.ts";
const ENGINE = ["test/payments.test.ts", "test/money-guards.test.ts", "test/guard-coverage.test.ts"];
const ROUTES = ["test/routes.test.ts"];

/** `[name, file, find, replace, tests]`. Replacing with `if (false)` keeps the code parsing. */
const MUTANTS = [
  // Quote guards
  ["echo: field check", G, "if (response.quoteRequest[field] !== sent[field]) throw", "if (false) throw", ENGINE],
  ["echo: our fee dropped", G, "if (!fees.some((entry) => entry.recipient === fee.recipient && entry.fee === fee.fee)) throw", "if (false) throw", ENGINE],
  ["echo: surprise fee", G, "if (total > allowed) throw", "if (false) throw", ENGINE],
  ["echo: exact output", G, 'if (sent.swapType === "EXACT_OUTPUT" && (amountOut !== sent.amount || BigInt(minAmountOut) < BigInt(sent.amount))) throw', "if (false) throw", ENGINE],
  ["echo: exact input", G, 'if (sent.swapType === "EXACT_INPUT" && amountIn !== sent.amount) throw', "if (false) throw", ENGINE],
  ["signature check", G, "if (!verifyQuoteSignature(response as unknown as SignedQuote, publicKey)) throw", "if (false) throw", ENGINE],
  ["usable: deposit address", G, "if (!depositAddress) throw", "if (false) throw", ENGINE],
  ["usable: deadline", G, "if (!Number.isFinite(parsed) || parsed <= now) throw", "if (false) throw", ENGINE],
  ["route minimum", G, "if (usd < minimum) throw badRequest(`${ASSETS[payAsset].chain} payments", "if (false) throw badRequest(`${ASSETS[payAsset].chain} payments", ENGINE],
  ["destination minimum", G, "if (usd < minimum) throw badRequest(`${ASSETS[receiveAsset].chain} transfers", "if (false) throw badRequest(`${ASSETS[receiveAsset].chain} transfers", ENGINE],
  ["minimum read from env", G, 'if (recipientType === "INTENTS" && env().MINIMUMS_EXEMPT_INTENTS_RECIPIENT) return 0;', 'if (recipientType === "INTENTS") return 0;', ENGINE],
  ["bounds: too small", G, "if (!Number.isFinite(usd) || usd < MIN_PAYMENT_USD) throw", "if (false) throw", ENGINE],
  ["bounds: too large", G, "if (usd > MAX_PAYMENT_USD) throw", "if (false) throw", ENGINE],
  ["route pause", G, "if (paused.length) throw conflict(", "if (false) throw conflict(", ENGINE],
  ["unverifiable route", G, "if (hasUnverifiableRoute(assets)) throw", "if (false) throw", ENGINE],
  ["fresh price", G, "if (!token?.price || !Number.isFinite(updated) || now - updated > PRICE_MAX_AGE_MS) throw", "if (false) throw", ENGINE],
  ["screening", G, "if (!hits.length) return;", "return;", ENGINE],
  ["refund fee share", G, "if (Number(fee) / Number(BigInt(quote.amountIn)) > MAX_REFUND_FEE_SHARE) {", "if (false) {", ENGINE],
  ["countdown margin", G, "deadline - marginMs", "deadline", ENGINE],
  ["countdown no safe window", G, "return end - now < 5 * 60_000 ? null : new Date(end);", "return new Date(end);", ENGINE],

  // Checkout
  ["checkout: premium limit", C, "if (!Number.isFinite(paying) || paying > usd * (1 + MAX_PREMIUM)) throw", "if (false) throw", ENGINE],
  ["checkout: premium call", C, "    assertQuoteReasonable(usd, response.quote);\n    assertRefundFeeReasonable(response.quote);\n    assertAboveRouteMinimum", "    assertRefundFeeReasonable(response.quote);\n    assertAboveRouteMinimum", ENGINE],
  ["checkout: echo call", C, "    assertQuoteEcho(request, response);\n    assertQuoteSigned(response, provider().quoteKey);\n    assertLiveQuoteUsable(response);", "    assertQuoteSigned(response, provider().quoteKey);\n    assertLiveQuoteUsable(response);", ENGINE],
  ["checkout: signature call", C, "    assertQuoteSigned(response, provider().quoteKey);\n    assertLiveQuoteUsable(response);", "    assertLiveQuoteUsable(response);", ENGINE],
  ["checkout: usable call", C, "    assertLiveQuoteUsable(response);\n", "", ENGINE],
  ["checkout: idempotency mismatch", C, "if (existing.payAsset !== input.payAsset || existing.payer !== refundTo || Number(existing.usd) !== usd) throw", "if (false) throw", ENGINE],
  ["checkout: accepted asset", C, "if (!source.accepted.includes(payAsset)) throw", "if (false) throw", ENGINE],
  ["checkout: refund address format", C, "if (!isValidAddress(kind, input.refundAddress.trim())) throw", "if (false) throw", ENGINE],
  ["checkout: screening call", C, 'await assertNotScreened([refundTo, target.recipient], { orgId: source.org.id, action: "checkout", ip: input.ip });', "", ENGINE],
  ["checkout: fixed amount", C, "if (source.amount !== null && requested != null && requested !== source.amount) throw", "if (false) throw", ENGINE],
  ["checkout: no safe window", C, "if (!payBy) {", "if (false) {", ENGINE],
  ["source: closed", "server/payments/source.ts", 'if (reason) throw conflict(reason, "source_closed");', "", ENGINE],
  ["source: direct mode chain", "server/payments/source.ts", 'if (ASSETS[receiveAsset].addressKind !== "evm") throw', "if (false) throw", ENGINE],

  // What a wallet is asked to sign
  ["payload: contract", I, "if (parsed.verifying_contract !== VERIFIER_CONTRACT) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: signer", I, 'if (typeof parsed.signer_id !== "string" || parsed.signer_id.toLowerCase() !== expected.signer.toLowerCase()) return', "if (false) return", ["test/intents.test.ts"]],
  ["payload: expired", I, "if (!Number.isFinite(deadline) || deadline <= now) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: one action", I, "if (!Array.isArray(parsed.intents) || parsed.intents.length !== 1) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: is a transfer", I, 'if (intent.intent !== "transfer") return', "if (false) return", ["test/intents.test.ts"]],
  ["payload: receiver", I, "if (intent.receiver_id !== expected.receiver) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: one token", I, "if (tokens.length !== 1) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: token", I, "if (assetId !== expected.assetId) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: amount", I, "if (amount !== expected.amount) return", "if (false) return", ["test/intents.test.ts"]],
  ["payload: extra fields", I, "if (unknown.length) return", "if (false) return", ["test/intents.test.ts"]],
  ["signature: always valid", I, "return ed25519.verify(decodeKey(response.signature), quoteMessage(response), decodeKey(publicKey));", "return true;", ["test/intents.test.ts"]],
  ["signature: recovery byte", I, "if (v === 27 || v === 28) bytes[64] = v - 27;", "if (false) bytes[64] = v - 27;", ["test/intents.test.ts"]],
  ["browser: live ignores server key", S, 'const key = expected.mode === "live" ? ONE_CLICK_QUOTE_KEY : prepared.quoteKey;', "const key = prepared.quoteKey;", ["test/sign-intent.test.ts"]],
  ["browser: signature", S, "if (!verifyQuoteSignature(response, key)) throw", "if (false) throw", ["test/sign-intent.test.ts"]],
  ["browser: recipient", S, "if (response.quoteRequest.recipient !== expected.recipient) throw", "if (false) throw", ["test/sign-intent.test.ts"]],
  ["browser: payload", S, "if (refusal) throw", "if (false) throw", ["test/sign-intent.test.ts"]],
  ["browser: right wallet", S, "if (account !== prepared.signer.toLowerCase()) throw", "if (false) throw", ["test/sign-intent.test.ts"]],

  // Moving money out
  ["intent: payload check on prepare", F, 'if (refusal) throw new GuardError("intent_mismatch"', 'if (false) throw new GuardError("intent_mismatch"', ENGINE],
  ["intent: payload check on send", F, 'if (refusal) throw badRequest(refusal, "intent_mismatch");', "", ENGINE],
  ["intent: signer", F, "if (recovered.toLowerCase() !== input.signer.toLowerCase()) throw", "if (false) throw", ENGINE],
  ["intent: destination chain", F, "if (!isValidAddress(destination.addressKind, input.recipient)) throw", "if (false) throw", ENGINE],
  ["intent: echo call", F, "  assertQuoteEcho(request, response);\n", "", ENGINE],
  ["intent: signature call", F, "  assertQuoteSigned(response, provider().quoteKey);\n", "", ENGINE],
  ["intent: zero amount", F, 'if (input.amountBase <= 0n) throw', "if (false) throw", ENGINE],
  ["payout: availability", P, 'if (amountBase > free) throw conflict("That\'s more than is available', 'if (false) throw conflict("That\'s more than is available', ENGINE],
  ["payout: destination approved", P, "  await assertDestinationApproved(destination, org.walletAddress);\n", "", ENGINE],
  ["payout: destination signer", P, "if (recovered?.toLowerCase() !== wallet.toLowerCase() || !destination.message.includes(destination.address)) throw", "if (false) throw", ENGINE],
  ["payout: destination tenant", P, "and(eq(schema.destinations.id, input.destinationId), eq(schema.destinations.orgId, org.id), isNull(schema.destinations.removedAt))", "and(eq(schema.destinations.id, input.destinationId), isNull(schema.destinations.removedAt))", ENGINE],
  ["payout: tenant", P, "and(eq(schema.payouts.id, input.payoutId), eq(schema.payouts.orgId, input.orgId))", "eq(schema.payouts.id, input.payoutId)", ENGINE],
  ["payout: single send", P, '.where(and(eq(schema.payouts.id, row.id), eq(schema.payouts.state, "awaiting_signature")))', ".where(eq(schema.payouts.id, row.id))", ENGINE],
  ["payout: already sent", P, 'if (row.state !== "awaiting_signature") return row;', "", ENGINE],
  ["payout: expired signature", P, "if (!row.signExpiresAt || row.signExpiresAt.getTime() < Date.now()) {", "if (false) {", ENGINE],
  ["payout: wallet changed", P, "if (org.walletAddress !== row.signer) throw", "if (false) throw", ENGINE],
  ["payout: screening", P, 'await assertNotScreened([destination.address, org.walletAddress], { orgId: org.id, action: "payout", ip: input.ip });', "", ENGINE],
  ["payout: route pause", P, "await assertRoutesOpen([input.asset, input.receiveAsset]);", "", ENGINE],
  ["refund: amount cap", R, 'if (amount > remaining) throw', "if (false) throw", ENGINE],
  ["refund: settled only", R, 'if (payment.state !== "settled") throw conflict("Only a settled payment', 'if (false) throw conflict("Only a settled payment', ENGINE],
  ["refund: balance", R, 'if (amount > free) throw', "if (false) throw", ENGINE],
  ["refund: previous wallet", R, 'if (payment.recipientType === "INTENTS" && payment.recipient !== org.walletAddress) throw', "if (false) throw", ENGINE],
  ["refund: tenant", R, "and(eq(schema.payments.id, input.paymentId), eq(schema.payments.orgId, org.id))", "eq(schema.payments.id, input.paymentId)", ENGINE],
  ["refund: send-time cap", R, 'if (BigInt(row.amountBase) > refundableBase(payment)) throw', "if (false) throw", ENGINE],
  ["refund: screening", R, 'await assertNotScreened([payment.payer], { orgId: org.id, action: "refund", ip: input.ip });', "", ENGINE],
  ["refund: open blocks a new one", R, 'if (Date.now() - open.createdAt.getTime() < ABANDON_AFTER_MS) throw', "if (false) throw", ENGINE],
  ["refund: same address again", R, "if (open.amountBase === amount.toString()) return routeRefundForClient(open);", "", ENGINE],

  // Who controls the money
  ["wallet: challenge", W, 'assertChallenge(input.message, "settlement", org.id, wallet);', "", ENGINE],
  ["wallet: challenge tag", W, "if (message !== `${body}\\nCode: ${tag(body)}` || code !== tag(body)) throw", "if (false) throw", ENGINE],
  ["wallet: challenge age", W, "if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) throw", "if (false) throw", ENGINE],
  ["wallet: new signature", W, "if ((await recoverSigner(input.message, input.newSignature)) !== wallet) throw", "if (false) throw", ENGINE],
  ["wallet: current signature needed", W, "if (!input.currentSignature) throw", "if (false) throw", ENGINE],
  ["wallet: current signature right", W, "if ((await recoverSigner(input.message, input.currentSignature)) !== org.walletAddress) throw", "if (false) throw", ENGINE],
  ["wallet: balance empty", W, 'if ([...balances.values()].some((amount) => amount > 0n) || held.size > 0 || moving.size > 0) throw', "if (false) throw", ENGINE],
  ["wallet: money on its way", W, "if (arriving.length) throw", "if (false) throw", ENGINE],
  ["wallet: screening", W, 'await assertNotScreened([wallet], { orgId: org.id, action: "wallet", ip: input.ip });', "", ENGINE],
  ["destination: signature needed", W, 'if (!input.message || !input.signature) throw conflict("Confirm this destination', 'if (false) throw conflict("Confirm this destination', ENGINE],
  ["destination: signer", W, 'if ((await recoverSigner(input.message, input.signature)) !== org.walletAddress) throw', "if (false) throw", ENGINE],
  ["destination: challenge", W, 'assertChallenge(input.message, "destination", org.id, address);', "", ENGINE],
  ["destination: screening", W, 'await assertNotScreened([address], { orgId: org.id, action: "destination", ip: input.ip });', "", ENGINE],

  // State
  ["state: refund owns its state", SM, "if (from === undefined || to === undefined) return null;", "if (to === undefined) return null;", ["test/state-machine.test.ts"]],
  ["state: settled is final", SM, 'if (current === "settled" || current === "provider_refunded") return null;', "", ["test/state-machine.test.ts"]],
  ["state: never backwards", SM, "return to >= from ? target : null;", "return target;", ["test/state-machine.test.ts"]],
  ["state: payout never un-sends", SM, 'if (current === "done" || current === "awaiting_signature" || current === "expired") return null;', "", ["test/state-machine.test.ts"]],
  ["poll: outage changes nothing", "server/payments/poller.ts", "const delay = nextPollDelayMs({ state: row.state as PaymentState, now: now.getTime(), createdAt: row.createdAt.getTime(), deadline: row.deadline?.getTime() ?? null, failures });", "const delay = 0; await db().update(schema.payments).set({ state: \"failed\" }).where(eq(schema.payments.id, paymentId));", ENGINE],

  ["poll: only the active mode", "server/payments/poller.ts", ' and live = ${provider().kind === "oneclick"}', "", ENGINE],

  // Live gates
  ["live: acknowledgement", "server/env.ts", 'if (config.LIVE_PAYMENTS_ACK !== LIVE_ACK_PHRASE) failures.push', "if (false) failures.push", ENGINE],
  ["live: api key", "server/env.ts", 'if (!config.ONECLICK_API_KEY) failures.push', "if (false) failures.push", ENGINE],
  ["live: fee recipient", "server/env.ts", 'if (config.APP_FEE_BPS > 0 && !config.APP_FEE_RECIPIENT) failures.push', "if (false) failures.push", ENGINE],
  ["live: mode needs the gates", "server/env.ts", 'return config.PAYMENTS_MODE === "live" && liveGateFailures(config).length === 0 ? "live" : "sim";', 'return config.PAYMENTS_MODE === "live" ? "live" : "sim";', ENGINE],
  ["live: no simulate route", "app/api/checkout/sessions/[id]/sim/route.ts", "if (!(active instanceof SimProvider)) throw notFound();", "", ROUTES],
  ["test mode can't fake a real payment", "app/api/checkout/sessions/[id]/sim/route.ts", "if (!row.depositAddress || row.live) throw notFound();", "if (!row.depositAddress) throw notFound();", ROUTES],
  ["live: no sample data", "app/api/sample-data/route.ts", 'if (paymentsMode() === "live") throw notFound();', "", ROUTES],

  // Access
  ["access: same origin", "server/http/route.ts", "if (origin !== expected) throw", "if (false) throw", ROUTES],
  ["access: permission", "server/http/route.ts", "if (!can(principal.role, permission)) throw forbidden();", "", ROUTES],
  ["access: session needed", "server/http/route.ts", "if (!principal) throw unauthorized();", "", ROUTES],
  ["access: session expiry", "server/auth/session.ts", "and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date()))", "eq(schema.sessions.tokenHash, tokenHash)", ROUTES],
  ["access: membership re-read", "server/auth/session.ts", "if (membership && isRole(membership.role)) role = membership.role;\n    else orgId = null;", 'role = "owner";', ROUTES],
  ["access: link tenant on update", "server/resources.ts", ".where(and(eq(schema.paymentLinks.id, id), eq(schema.paymentLinks.orgId, actor.orgId)))\n    .returning();", ".where(eq(schema.paymentLinks.id, id))\n    .returning();", ROUTES],
  ["access: link id takeover", "server/resources.ts", 'if (existing && existing.orgId !== actor.orgId) throw conflict("That id is already in use.");\n  const values = { title', 'const values = { title', ROUTES],
  ["access: login once", "app/api/auth/verify/route.ts", "isNull(schema.loginTokens.usedAt), ", "", ROUTES],
  ["access: login expiry", "app/api/auth/verify/route.ts", ", gt(schema.loginTokens.expiresAt, new Date())", "", ROUTES],
  ["access: invite email", "app/api/invites/accept/route.ts", "if (invite.email !== principal.user.email) throw", "if (false) throw", ROUTES],
  ["access: revoked key", "server/http/api-key.ts", "and(eq(schema.apiKeys.keyHash, hashSecret(key)), isNull(schema.apiKeys.revokedAt))", "eq(schema.apiKeys.keyHash, hashSecret(key))", ROUTES],
  ["access: idempotency body", "server/http/api-key.ts", 'if (existing.requestHash !== requestHash) throw', "if (false) throw", ROUTES],
  ["access: owner can't be removed", "app/api/team/members/[id]/route.ts", 'if (member.role === "owner") throw', "if (false) throw", ROUTES],
  ["access: settlement mode owner only", "app/api/settings/route.ts", 'if (patch.settlementMode !== undefined && !can(role, "wallet:write")) throw', "if (false) throw", ROUTES],
  ["access: safe success URL", "server/schemas.ts", 'return protocol === "https:" || protocol === "http:";', "return true;", ROUTES],

  // Webhooks
  ["webhook: rebinding", "server/webhooks/deliver.ts", "const blocked = !allowPrivate && list.some((entry) => isPrivateAddress(entry.address));", "const blocked = false;", ["test/ssrf.test.ts"]],
  ["webhook: private literal", "server/webhooks/deliver.ts", "if (isIP(host) && isPrivateAddress(host)) throw", "if (false) throw", ["test/webhooks.test.ts", ...ROUTES]],
  ["webhook: https only", "server/webhooks/deliver.ts", 'if (url.protocol !== "https:") throw', "if (false) throw", ["test/webhooks.test.ts", ...ROUTES]],
  ["webhook: metadata range", "server/webhooks/deliver.ts", "(a === 169 && b === 254) || ", "", ["test/webhooks.test.ts"]],
  ["webhook: replay window", "server/crypto.ts", "if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;", "", ["test/webhooks.test.ts"]],
  ["webhook: alerts stay internal", "server/jobs.ts", "if (!NOT_WEBHOOKS.test(event.type)) {", "if (true) {", ["test/webhooks.test.ts"]],
  ["sanctions: never empties", "server/jobs.ts", "if (!addresses.length) continue;", "if (!addresses.length) { await db().delete(schema.screenedAddresses); continue; }", ["test/webhooks.test.ts"]],
];

const words = process.argv.slice(2).map((word) => word.toLowerCase());
const chosen = words.length ? MUTANTS.filter(([name]) => words.some((word) => name.toLowerCase().includes(word))) : MUTANTS;

function run(tests) {
  const result = spawnSync("npx", ["vitest", "run", "--bail=1", "--reporter=dot", ...tests], { encoding: "utf8", timeout: 240_000 });
  return result.status === 0;
}

const started = Date.now();
if (!run(["test/intents.test.ts", "test/state-machine.test.ts"])) {
  console.error("The tests fail before any mutation. Fix that first.");
  process.exit(2);
}

const results = { KILLED: [], SURVIVED: [], STALE: [] };
for (const [name, file, find, replace, tests] of chosen) {
  const original = readFileSync(file, "utf8");
  if (!original.includes(find)) {
    results.STALE.push(name);
    console.log(`STALE     ${name}  (${file})`);
    continue;
  }
  writeFileSync(file, original.replace(find, replace));
  let passed;
  try {
    passed = run(tests);
  } finally {
    writeFileSync(file, original);
  }
  const verdict = passed ? "SURVIVED" : "KILLED";
  results[verdict].push(name);
  console.log(`${verdict.padEnd(9)} ${name}`);
}

console.log(`\n${chosen.length} mutants in ${Math.round((Date.now() - started) / 1000)}s: ${results.KILLED.length} killed, ${results.SURVIVED.length} survived, ${results.STALE.length} stale`);
for (const name of results.SURVIVED) console.log(`  survived: ${name}`);
for (const name of results.STALE) console.log(`  stale: ${name}`);
process.exit(results.SURVIVED.length || results.STALE.length ? 1 : 0);
