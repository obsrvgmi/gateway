export type AssetSymbol = "ETH" | "BTC" | "SOL" | "NEAR" | "USDT" | "USDC" | "BNB" | "ARB";
export type LinkStatus = "active" | "paused" | "expired";
export type PaymentStatus = "settled" | "processing" | "refunded" | "expired" | "failed";
export type WidgetStatus = "live" | "paused";
export type WidgetTheme = "light" | "dark" | "auto";
export type WidgetRadius = "rounded" | "soft" | "sharp";

export interface PaymentLink {
  id: string;
  title: string;
  description: string;
  /** Null lets the customer enter the amount, in USD. */
  amount: number | null;
  receiveAsset: AssetSymbol;
  status: LinkStatus;
  expiresAt: string | null;
  successUrl: string;
  createdAt: string;
}

export interface Widget {
  id: string;
  name: string;
  site: string;
  status: WidgetStatus;
  theme: WidgetTheme;
  accent: string;
  radius: WidgetRadius;
  amount: number | null;
  receiveAsset: AssetSymbol;
  buttonLabel: string;
  showBranding: boolean;
  /** Assets the customer can pay with. Never empty; the builder keeps at least one. */
  acceptedAssets: AssetSymbol[];
  /** Quick-pick amounts shown when the customer sets the amount. */
  presets: number[];
  /** Name shown at checkout. Empty falls back to the business name. */
  displayName: string;
  /** A small data URL from the builder, or empty for initials. */
  logo: string;
  collectEmail: boolean;
  success: WidgetSuccess;
  createdAt: string;
}

export type WidgetSuccessMode = "receipt" | "message" | "redirect";

export interface WidgetSuccess {
  mode: WidgetSuccessMode;
  message: string;
  url: string;
}

export interface Payment {
  id: string;
  sourceType: "link" | "widget";
  sourceId: string;
  sourceName: string;
  payAsset: AssetSymbol;
  payAmount: number;
  receiveAsset: AssetSymbol;
  receiveAmount: number;
  usd: number;
  status: PaymentStatus;
  payer: string;
  settleSeconds: number | null;
  createdAt: string;
  /** Set when a refund to the customer has completed. */
  refundedAt?: string;
  /** Test mode or sample data: no real funds moved. */
  simulated?: boolean;
  /** What the customer paid above the merchant's amount, from the provider's quote. */
  feeUsd?: number;
  /** Lifecycle detail for the drawer; absent on sample data. */
  detail?: PaymentDetail;
}

export interface TxRef {
  hash: string;
  explorerUrl: string;
}

export interface PaymentDetail {
  state: string;
  depositAddress: string | null;
  depositedAt: string | null;
  settledAt: string | null;
  originTxs: TxRef[];
  destinationTxs: TxRef[];
  failureReason: string | null;
  /** The provider returned the customer's deposit, for example after an underpayment. */
  returnedToCustomer: boolean;
  customerEmail: string | null;
  /** An open refund, if any. */
  refundState: string | null;
  refundedUsd: number;
}

export type PayoutStatus = "awaiting_signature" | "processing" | "sent" | "failed" | "expired";
export type PayoutTrigger = "scheduled" | "manual";

/** A sweep from the merchant's settlement account to a destination, signed by the merchant's wallet. */
export interface Payout {
  id: string;
  /** What leaves the settlement account. */
  asset: AssetSymbol;
  amount: number;
  /** What the destination receives. Differs from `asset` when the sweep swaps. */
  receiveAsset: AssetSymbol;
  receiveAmount: number;
  /** Value at the mock price when requested. */
  usd: number;
  /** Route fee on a swap plus the flat network fee. */
  feeUsd: number;
  destinationId: string;
  /** Copied at request time, so history survives a destination being removed. */
  destinationLabel: string;
  destinationAddress: string;
  status: PayoutStatus;
  trigger: PayoutTrigger;
  paymentCount: number;
  /** The destination transaction hash once sent, or `sim_…` in test mode. */
  reference: string;
  /** Test mode or sample data: no real funds moved. */
  simulated?: boolean;
  explorerUrl?: string;
  createdAt: string;
  completedAt: string | null;
  failureReason?: string;
}

export interface PayoutDestination {
  id: string;
  label: string;
  address: string;
}

export type PayoutSchedule = "daily" | "weekly" | "manual";

export interface PayoutSettings {
  schedule: PayoutSchedule;
  /** The merchant's own refund window. Settled funds wait this long before they can be paid out. */
  holdDays: number;
  /** Scheduled payouts skip an asset below this value. */
  minimumUsd: number;
  destinations: PayoutDestination[];
  defaultDestinationId: string;
}

export interface ApiKey {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
}

export type WebhookEvent = "payment.processing" | "payment.settled" | "payment.refunded" | "payment.expired" | "payment.failed" | "payout.sent" | "payout.failed" | "link.created";

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
}

export type TeamRole = "owner" | "admin" | "finance" | "viewer";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: "active" | "invited";
  createdAt: string;
}

export interface Branding {
  accent: string;
  supportEmail: string;
  statementName: string;
}

export interface NotificationPrefs {
  settled: boolean;
  processing: boolean;
  refunded: boolean;
  expired: boolean;
  links: boolean;
}

export type SettlementMode = "balance" | "direct";

export interface AssetAmount {
  asset: AssetSymbol;
  /** Exact, in the asset's smallest unit. Numbers are for display only. */
  base: string;
  amount: number;
  usd: number;
}

export interface Settlement {
  mode: SettlementMode;
  /** The merchant's own wallet. Only this key can move a settlement balance. */
  wallet: string | null;
  /** The merchant's settlement account as read from chain, when `balance` mode has a wallet. */
  balances: AssetAmount[];
  /** Balance less funds on hold and in flight. What a payout can send now. */
  available: AssetAmount[];
  /** False when the balance read failed; show the last figures as stale, never as zero. */
  balancesFresh: boolean;
}

export interface Settings {
  businessName: string;
  receiveAsset: AssetSymbol;
  /** The default destination's address, kept for everything that shows where payouts go. */
  walletAddress: string;
  apiKeys: ApiKey[];
  webhooks: Webhook[];
  team: TeamMember[];
  branding: Branding;
  notifications: NotificationPrefs;
  payouts: PayoutSettings;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  role: TeamRole;
}

export type PaymentsMode = "sim" | "live";

export interface GatewayState {
  links: PaymentLink[];
  widgets: Widget[];
  payments: Payment[];
  payouts: Payout[];
  settings: Settings;
  setupDismissed: boolean;
  /** Who is signed in. Null before the first load. */
  me: Me | null;
  mode: PaymentsMode;
  settlement: Settlement;
  /** The provider's current USD prices, for display. */
  prices: Partial<Record<AssetSymbol, number>>;
  /** True when older payments were left out of `payments`. */
  paymentsTruncated: boolean;
  notifications: AppNotification[];
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string;
  createdAt: string;
  read: boolean;
}
