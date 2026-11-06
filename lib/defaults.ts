import type { AssetSymbol, GatewayState, WidgetSuccess } from "./types";

const RECEIPT: WidgetSuccess = { mode: "receipt", message: "", url: "" };

/** What the widget builder starts from. */
export const WIDGET_DEFAULTS = { acceptedAssets: ["ETH", "BTC", "SOL", "NEAR", "USDT", "USDC", "BNB", "ARB"] as AssetSymbol[], presets: [] as number[], displayName: "", logo: "", collectEmail: false, success: RECEIPT };

/** Before the first load. Shared by the server render and the first client render, so they match. */
export const EMPTY_STATE: GatewayState = {
  links: [],
  widgets: [],
  payments: [],
  payouts: [],
  settings: {
    businessName: "",
    receiveAsset: "USDC",
    walletAddress: "",
    apiKeys: [],
    webhooks: [],
    team: [],
    branding: { accent: "#00EC97", supportEmail: "", statementName: "" },
    notifications: { settled: true, processing: false, refunded: true, expired: false, links: true },
    payouts: { schedule: "manual", holdDays: 0, minimumUsd: 0, destinations: [], defaultDestinationId: "" },
  },
  setupDismissed: false,
  me: null,
  mode: "sim",
  settlement: { mode: "balance", wallet: null, balances: [], available: [], balancesFresh: true },
  prices: {},
  paymentsTruncated: false,
  notifications: [],
};
