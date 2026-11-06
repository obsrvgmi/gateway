import "server-only";
import { env, liveGateFailures, paymentsMode } from "../../env";
import { log } from "../../log";
import { OneClickProvider } from "./oneclick";
import { SimProvider } from "./sim";
import type { SwapProvider } from "./types";

let cached: { mode: "sim" | "live"; provider: SwapProvider } | null = null;
let override: SwapProvider | null = null;

/** Lets a test supply a fake 1Click that returns hostile responses. */
export function setProviderForTests(provider: SwapProvider | null) {
  override = provider;
}

/** Real money only when `paymentsMode` says every live gate passed. */
export function provider(): SwapProvider {
  if (override) return override;
  const mode = paymentsMode();
  if (cached?.mode === mode) return cached.provider;
  const config = env();
  if (config.PAYMENTS_MODE === "live" && mode !== "live") log("error", "PAYMENTS_MODE=live refused; running in test mode", { reasons: liveGateFailures(config) });
  const next: SwapProvider = mode === "live" ? new OneClickProvider({ baseUrl: config.ONECLICK_BASE_URL, apiKey: config.ONECLICK_API_KEY, nearRpcUrl: config.NEAR_RPC_URL }) : new SimProvider();
  cached = { mode, provider: next };
  return next;
}

export const isLive = () => provider().kind === "oneclick";
