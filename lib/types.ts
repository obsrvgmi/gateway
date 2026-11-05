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
  createdAt: string;
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
}

export interface GatewayState {
  links: PaymentLink[];
  widgets: Widget[];
  payments: Payment[];
  settings: Settings;
  setupDismissed: boolean;
}
