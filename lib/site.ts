/** Bump when the Merchant Terms change. Acceptance is stored per workspace with this version. */
export const TERMS_VERSION = "2026-11-06";

/** Working name and marketing figures. `chainsSupported` must match `ASSETS`. `settlement` is the route's own estimate, not a measurement. */
export const SITE = {
  name: "Gateway",
  tagline: "Accept any crypto. Get paid in the asset you want.",
  merchant: "Lumen Studio",
  chainsSupported: "8",
  settlement: "~1 min",
} as const;
