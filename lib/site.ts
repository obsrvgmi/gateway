/** Bump when the Merchant Terms change. Acceptance is stored per workspace with this version. */
export const TERMS_VERSION = "2026-11-06";

/** Working name and marketing figures. All placeholders until product confirms them. */
export const SITE = {
  name: "Gateway",
  tagline: "Accept any crypto. Get paid in the asset you want.",
  merchant: "Lumen Studio",
  chainsSupported: "25+",
  settlement: "~30s",
} as const;
