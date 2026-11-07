import { sql } from "drizzle-orm";
import { bigserial, boolean, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Amounts in an asset's smallest unit. Read as strings and computed with BigInt, never as floats. */
const base = (name: string) => numeric(name, { precision: 78, scale: 0 });
const usd = (name: string) => numeric(name, { precision: 18, scale: 6 });
const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => at("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  createdAt: createdAt(),
  lastLoginAt: at("last_login_at"),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  /** Ties the link to the browser that asked for it. Opening it anywhere else needs a confirmation. */
  nonceHash: text("nonce_hash"),
  expiresAt: at("expires_at").notNull(),
  usedAt: at("used_at"),
  createdAt: createdAt(),
});

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  businessName: text("business_name").notNull(),
  receiveAsset: text("receive_asset").notNull().default("USDC"),
  /** `balance` settles into the merchant's own Intents account; `direct` goes straight to `walletAddress`. */
  settlementMode: text("settlement_mode").notNull().default("balance"),
  /** The merchant's EVM wallet, lowercase. Only this key can move a balance. Gateway never holds it. */
  walletAddress: text("wallet_address"),
  walletVerifiedAt: at("wallet_verified_at"),
  branding: jsonb("branding").$type<{ accent: string; supportEmail: string; statementName: string }>().notNull(),
  notifications: jsonb("notifications").$type<{ settled: boolean; processing: boolean; refunded: boolean; expired: boolean; links: boolean }>().notNull(),
  payoutSchedule: text("payout_schedule").notNull().default("manual"),
  holdDays: integer("hold_days").notNull().default(0),
  minimumUsd: numeric("minimum_usd", { precision: 18, scale: 2 }).notNull().default("0"),
  defaultDestinationId: text("default_destination_id"),
  lastScheduledPromptAt: at("last_scheduled_prompt_at"),
  termsVersion: text("terms_version"),
  termsAcceptedAt: at("terms_accepted_at"),
  termsAcceptedBy: text("terms_accepted_by"),
  setupDismissed: boolean("setup_dismissed").notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.userId] }), index("memberships_user_idx").on(table.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** The workspace this session is acting in. Checked against `memberships` on every request. */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "set null" }),
    expiresAt: at("expires_at").notNull(),
    lastSeenAt: at("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

export const invites = pgTable(
  "invites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull(),
    expiresAt: at("expires_at").notNull(),
    acceptedAt: at("accepted_at"),
    revokedAt: at("revoked_at"),
    createdAt: createdAt(),
  },
  (table) => [index("invites_org_idx").on(table.orgId)],
);

/** A record of each settlement wallet set. It redirects all future money, so it always carries wallet proof. */
export const walletChanges = pgTable(
  "wallet_changes",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    fromWallet: text("from_wallet"),
    toWallet: text("to_wallet").notNull(),
    requestedBy: text("requested_by").notNull(),
    message: text("message").notNull().unique(),
    newWalletSignature: text("new_wallet_signature").notNull(),
    currentWalletSignature: text("current_wallet_signature"),
    createdAt: createdAt(),
  },
  (table) => [index("wallet_changes_org_idx").on(table.orgId)],
);

export const paymentLinks = pgTable(
  "payment_links",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }),
    receiveAsset: text("receive_asset").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: at("expires_at"),
    successUrl: text("success_url").notNull().default(""),
    sample: boolean("sample").notNull().default(false),
    expiryNoticeAt: at("expiry_notice_at"),
    createdAt: createdAt(),
    deletedAt: at("deleted_at"),
  },
  (table) => [index("payment_links_org_idx").on(table.orgId)],
);

export const widgets = pgTable(
  "widgets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    site: text("site").notNull().default(""),
    status: text("status").notNull().default("live"),
    theme: text("theme").notNull().default("auto"),
    accent: text("accent").notNull(),
    radius: text("radius").notNull().default("rounded"),
    amountUsd: numeric("amount_usd", { precision: 18, scale: 2 }),
    receiveAsset: text("receive_asset").notNull(),
    buttonLabel: text("button_label").notNull().default("Pay"),
    showBranding: boolean("show_branding").notNull().default(true),
    acceptedAssets: jsonb("accepted_assets").$type<string[]>().notNull(),
    presets: jsonb("presets").$type<number[]>().notNull(),
    displayName: text("display_name").notNull().default(""),
    logo: text("logo").notNull().default(""),
    collectEmail: boolean("collect_email").notNull().default(false),
    success: jsonb("success").$type<{ mode: string; message: string; url: string }>().notNull(),
    sample: boolean("sample").notNull().default(false),
    createdAt: createdAt(),
    deletedAt: at("deleted_at"),
  },
  (table) => [index("widgets_org_idx").on(table.orgId)],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    /** Repeating a checkout request with the same key returns this payment, not a second deposit address. */
    idempotencyKey: text("idempotency_key"),
    state: text("state").notNull(),
    payAsset: text("pay_asset").notNull(),
    receiveAsset: text("receive_asset").notNull(),
    usd: usd("usd").notNull(),
    feeUsd: usd("fee_usd").notNull().default("0"),
    /** Quoted deposit, the minimum the provider accepts, and the exact amount the merchant receives. */
    payBase: base("pay_base"),
    minPayBase: base("min_pay_base"),
    receiveBase: base("receive_base").notNull(),
    payer: text("payer").notNull(),
    customerEmail: text("customer_email"),
    settlementMode: text("settlement_mode").notNull(),
    recipient: text("recipient").notNull(),
    recipientType: text("recipient_type").notNull(),
    depositAddress: text("deposit_address"),
    depositMemo: text("deposit_memo"),
    /** The provider's real deadline, which can be days past what we asked for. Funds sent after it may be lost. */
    deadline: at("deadline"),
    /** Our own countdown for the customer, always before `deadline`. */
    payBy: at("pay_by"),
    quote: jsonb("quote"),
    quoteSignature: text("quote_signature"),
    correlationId: text("correlation_id"),
    providerStatus: text("provider_status"),
    originTxHashes: jsonb("origin_tx_hashes").$type<{ hash: string; explorerUrl: string }[]>().notNull().default([]),
    destinationTxHashes: jsonb("destination_tx_hashes").$type<{ hash: string; explorerUrl: string }[]>().notNull().default([]),
    depositedBase: base("deposited_base"),
    receivedBase: base("received_base"),
    providerRefundedBase: base("provider_refunded_base"),
    providerRefundReason: text("provider_refund_reason"),
    failureReason: text("failure_reason"),
    /** The customer's own transaction, if their browser sent it. Stops a reload offering a second send. */
    clientTxHash: text("client_tx_hash"),
    settleSeconds: integer("settle_seconds"),
    /** The refunded amount in `receiveAsset` base units, summed from completed refunds. */
    refundedBase: base("refunded_base").notNull().default("0"),
    live: boolean("live").notNull().default(false),
    sample: boolean("sample").notNull().default(false),
    nextPollAt: at("next_poll_at"),
    pollFailures: integer("poll_failures").notNull().default(0),
    depositSeenAt: at("deposit_seen_at"),
    settledAt: at("settled_at"),
    refundedAt: at("refunded_at"),
    createdAt: createdAt(),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_idempotency_idx").on(table.sourceId, table.idempotencyKey),
    uniqueIndex("payments_deposit_idx").on(table.depositAddress, table.depositMemo),
    index("payments_org_created_idx").on(table.orgId, table.createdAt),
    index("payments_org_updated_idx").on(table.orgId, table.updatedAt),
    index("payments_poll_idx").on(table.nextPollAt).where(sql`${table.nextPollAt} is not null`),
  ],
);

/** Append-only history of every payment state change, with the provider's raw status. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    paymentId: text("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    fromState: text("from_state"),
    toState: text("to_state").notNull(),
    providerStatus: text("provider_status"),
    detail: jsonb("detail"),
    at: at("at").notNull().defaultNow(),
  },
  (table) => [index("payment_events_payment_idx").on(table.paymentId)],
);

export const destinations = pgTable(
  "destinations",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    address: text("address").notNull(),
    /** Signed by the settlement wallet. Checked before each payout, so a stolen session can't add one. */
    message: text("message"),
    signature: text("signature"),
    createdAt: createdAt(),
    removedAt: at("removed_at"),
  },
  (table) => [index("destinations_org_idx").on(table.orgId)],
);

export const payouts = pgTable(
  "payouts",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    /** awaiting_signature, submitting, processing, sent, failed, expired */
    state: text("state").notNull(),
    asset: text("asset").notNull(),
    amountBase: base("amount_base").notNull(),
    receiveAsset: text("receive_asset").notNull(),
    receiveBase: base("receive_base").notNull(),
    minReceiveBase: base("min_receive_base").notNull(),
    usd: usd("usd").notNull(),
    feeUsd: usd("fee_usd").notNull().default("0"),
    destinationId: text("destination_id").notNull(),
    destinationLabel: text("destination_label").notNull(),
    destinationAddress: text("destination_address").notNull(),
    trigger: text("trigger").notNull().default("manual"),
    paymentCount: integer("payment_count").notNull().default(0),
    signer: text("signer").notNull(),
    depositAddress: text("deposit_address"),
    depositMemo: text("deposit_memo"),
    quote: jsonb("quote"),
    quoteSignature: text("quote_signature"),
    intent: jsonb("intent"),
    signature: text("signature"),
    intentHash: text("intent_hash"),
    signExpiresAt: at("sign_expires_at"),
    providerStatus: text("provider_status"),
    destinationTxHashes: jsonb("destination_tx_hashes").$type<{ hash: string; explorerUrl: string }[]>().notNull().default([]),
    failureReason: text("failure_reason"),
    failedAt: at("failed_at"),
    requestedBy: text("requested_by"),
    live: boolean("live").notNull().default(false),
    sample: boolean("sample").notNull().default(false),
    nextPollAt: at("next_poll_at"),
    pollFailures: integer("poll_failures").notNull().default(0),
    submitAttemptedAt: at("submit_attempted_at"),
    createdAt: createdAt(),
    completedAt: at("completed_at"),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("payouts_org_created_idx").on(table.orgId, table.createdAt),
    index("payouts_poll_idx").on(table.nextPollAt).where(sql`${table.nextPollAt} is not null`),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    paymentId: text("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
    /** `intent` is signed from the merchant's balance; `route` is a deposit the merchant sends from their wallet. */
    kind: text("kind").notNull(),
    /** awaiting_signature, awaiting_deposit, submitting, processing, refunded, failed, expired */
    state: text("state").notNull(),
    asset: text("asset").notNull(),
    amountBase: base("amount_base").notNull(),
    payAsset: text("pay_asset").notNull(),
    payBase: base("pay_base"),
    usd: usd("usd").notNull(),
    recipient: text("recipient").notNull(),
    signer: text("signer"),
    depositAddress: text("deposit_address"),
    depositMemo: text("deposit_memo"),
    quote: jsonb("quote"),
    quoteSignature: text("quote_signature"),
    intent: jsonb("intent"),
    signature: text("signature"),
    intentHash: text("intent_hash"),
    signExpiresAt: at("sign_expires_at"),
    providerStatus: text("provider_status"),
    txHash: text("tx_hash"),
    /** The merchant's own transaction on a route refund. Stops reopening it offering a second send. */
    depositTxHash: text("deposit_tx_hash"),
    failureReason: text("failure_reason"),
    failedAt: at("failed_at"),
    requestedBy: text("requested_by"),
    live: boolean("live").notNull().default(false),
    nextPollAt: at("next_poll_at"),
    pollFailures: integer("poll_failures").notNull().default(0),
    submitAttemptedAt: at("submit_attempted_at"),
    createdAt: createdAt(),
    completedAt: at("completed_at"),
    updatedAt: at("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("refunds_org_idx").on(table.orgId),
    index("refunds_payment_idx").on(table.paymentId),
    index("refunds_poll_idx").on(table.nextPollAt).where(sql`${table.nextPollAt} is not null`),
    // The database's own guarantee: overlapping requests can't open two refunds on one payment.
    uniqueIndex("refunds_one_open_idx").on(table.paymentId).where(sql`${table.state} in ('awaiting_deposit', 'submitting', 'processing')`),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
    lastUsedAt: at("last_used_at"),
    revokedAt: at("revoked_at"),
  },
  (table) => [index("api_keys_org_idx").on(table.orgId)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    events: jsonb("events").$type<string[]>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** AES-256-GCM under SECRET_KEY. The plain signing secret is shown once, on creation. */
    secretEnc: text("secret_enc").notNull(),
    createdAt: createdAt(),
    deletedAt: at("deleted_at"),
  },
  (table) => [index("webhooks_org_idx").on(table.orgId)],
);

/** Written in the same transaction as the change it reports, so an event can't be lost or invented. */
export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: text("org_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
    processedAt: at("processed_at"),
  },
  (table) => [index("outbox_pending_idx").on(table.id).where(sql`${table.processedAt} is null`)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    body: text("body").notNull(),
    /** pending, delivered, failed */
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: at("next_attempt_at"),
    lastStatus: integer("last_status"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    deliveredAt: at("delivered_at"),
  },
  (table) => [
    uniqueIndex("webhook_deliveries_unique_idx").on(table.webhookId, table.eventId),
    index("webhook_deliveries_due_idx").on(table.nextAttemptAt).where(sql`${table.state} = 'pending'`),
    index("webhook_deliveries_org_idx").on(table.orgId, table.createdAt),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    href: text("href").notNull().default(""),
    createdAt: createdAt(),
    readAt: at("read_at"),
  },
  (table) => [index("notifications_org_idx").on(table.orgId, table.createdAt)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: text("org_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target"),
    detail: jsonb("detail"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (table) => [index("audit_log_org_idx").on(table.orgId, table.createdAt)],
);

/** Operator off switches. `chain:bsc`, `asset:BNB`, or `payments` for everything. */
export const routeControls = pgTable("route_controls", {
  key: text("key").primaryKey(),
  paused: boolean("paused").notNull().default(true),
  reason: text("reason").notNull().default(""),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

export const screenedAddresses = pgTable("screened_addresses", {
  address: text("address").primaryKey(),
  source: text("source").notNull(),
  listedAt: at("listed_at").notNull().defaultNow(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: at("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.key, table.windowStart] }), index("rate_limits_window_idx").on(table.windowStart)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    orgId: text("org_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: integer("status"),
    response: jsonb("response"),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.key] })],
);

/** Test-mode stand-in for the provider. It lives here because the web and worker processes share it. */
export const simSwaps = pgTable("sim_swaps", {
  depositAddress: text("deposit_address").primaryKey(),
  status: text("status").notNull(),
  request: jsonb("request").notNull(),
  quote: jsonb("quote").notNull(),
  depositedBase: base("deposited_base"),
  updatedAt: at("updated_at").notNull().defaultNow(),
});

/** Test-mode balances, keyed by Intents account and asset id. Real balances are read from `intents.near`. */
export const simBalances = pgTable(
  "sim_balances",
  {
    account: text("account").notNull(),
    assetId: text("asset_id").notNull(),
    amount: base("amount").notNull().default("0"),
  },
  (table) => [primaryKey({ columns: [table.account, table.assetId] })],
);

/** When each background job last ran. `/api/health` reports a stalled worker from this. */
export const heartbeats = pgTable("heartbeats", {
  name: text("name").primaryKey(),
  at: at("at").notNull().defaultNow(),
});
