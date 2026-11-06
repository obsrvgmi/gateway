export type AssetSymbol = "ETH" | "BTC" | "SOL" | "NEAR" | "USDT" | "USDC" | "BNB" | "ARB";
export type LinkStatus = "active" | "paused" | "expired";
export type PaymentStatus = "settled" | "processing" | "refunded" | "expired";
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
  /** Set when the merchant marks a settled payment as refunded. */
  refundedAt?: string;
  /** Created by the dashboard's live simulator, not by a checkout. */
  simulated?: boolean;
}

export type PayoutStatus = "processing" | "sent" | "failed";
export type PayoutTrigger = "scheduled" | "manual";

/** A simulated sweep from the merchant's settlement account to a destination. No funds ever move. */
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
  /** Stands in for a transaction hash. Prefixed `sim_` so it can't be mistaken for one. */
  reference: string;
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

export type WebhookEvent = "payment.processing" | "payment.settled" | "payment.refunded" | "payment.expired" | "link.created";

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

export interface Settings {
  businessName: string;
  receiveAsset: AssetSymbol;
  walletAddress: string;
  apiKeys: ApiKey[];
  webhooks: Webhook[];
  team: TeamMember[];
  branding: Branding;
  notifications: NotificationPrefs;
  payouts: PayoutSettings;
}

export interface GatewayState {
  links: PaymentLink[];
  widgets: Widget[];
  payments: Payment[];
  payouts: Payout[];
  settings: Settings;
  setupDismissed: boolean;
}
