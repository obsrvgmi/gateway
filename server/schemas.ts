import { z } from "zod";
import { ASSET_SYMBOLS, RECEIVE_ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";

const receiveSymbols = RECEIVE_ASSETS.map((asset) => asset.symbol) as [AssetSymbol, ...AssetSymbol[]];
export const assetSymbol = z.enum(ASSET_SYMBOLS as [AssetSymbol, ...AssetSymbol[]]);
export const receiveSymbol = z.enum(receiveSymbols);

/** A client-proposed id: its prefix plus at least 16 random characters. */
export const clientId = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[a-z0-9]{16,40}$`), "Invalid id.");

/** Only http and https can reach a browser's address bar or an `href`, which rules out `javascript:`. */
export const webUrl = z.string().trim().max(2000).refine((value) => {
  if (value === "") return true;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}, "Enter a full http or https URL.");

const usdAmount = z.number().positive().max(100_000_000).refine((value) => Math.round(value * 100) / 100 === value, "Use at most two decimal places.");
const isoDate = z.string().datetime({ offset: true });
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a six-digit hex colour.");

/** Raster images only. An SVG data URL can carry script. */
const logoDataUrl = z.string().max(120_000).refine((value) => value === "" || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value), "Logo must be a PNG, JPEG or WebP image.");

/**
 * The shape with no defaults. Zod keeps `.default()` through `.partial()`, so a patch built on a schema
 * with defaults would write them for every field left out: one `{ title }` would reopen a paused link
 * and blank its description.
 */
const linkShape = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200),
  description: z.string().trim().max(1000),
  amount: usdAmount.nullable(),
  receiveAsset: receiveSymbol,
  status: z.enum(["active", "paused", "expired"]),
  expiresAt: isoDate.nullable(),
  successUrl: webUrl,
});

export const linkFields = linkShape.extend({
  description: linkShape.shape.description.default(""),
  status: linkShape.shape.status.default("active"),
  expiresAt: linkShape.shape.expiresAt.default(null),
  successUrl: linkShape.shape.successUrl.default(""),
});

export const linkCreate = linkFields.extend({ id: clientId("lnk_").optional() });
export const linkPatch = linkShape.partial();

const widgetSuccess = z.object({
  mode: z.enum(["receipt", "message", "redirect"]),
  message: z.string().max(500),
  url: webUrl,
});

/** A bare host, because it goes into a Content-Security-Policy header. A pasted URL is cut down to its host. */
export const siteHost = z.string().trim().toLowerCase().max(253).transform((value) => value.replace(/^https?:\/\//, "").replace(/[/?#].*$/, "")).refine((value) => value === "" || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(value), "Enter a site like shop.example.com.");

const widgetShape = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  site: siteHost,
  status: z.enum(["live", "paused"]),
  theme: z.enum(["light", "dark", "auto"]),
  accent: hexColor,
  radius: z.enum(["rounded", "soft", "sharp"]),
  amount: usdAmount.nullable(),
  receiveAsset: receiveSymbol,
  buttonLabel: z.string().trim().min(1).max(60),
  showBranding: z.boolean(),
  acceptedAssets: z.array(assetSymbol).min(1, "Accept at least one asset.").max(ASSET_SYMBOLS.length),
  presets: z.array(usdAmount).max(6),
  displayName: z.string().trim().max(120),
  logo: logoDataUrl,
  collectEmail: z.boolean(),
  success: widgetSuccess,
});

export const widgetFields = widgetShape.extend({
  site: widgetShape.shape.site.default(""),
  status: widgetShape.shape.status.default("live"),
  theme: widgetShape.shape.theme.default("auto"),
  radius: widgetShape.shape.radius.default("rounded"),
  showBranding: widgetShape.shape.showBranding.default(true),
  presets: widgetShape.shape.presets.default([]),
  displayName: widgetShape.shape.displayName.default(""),
  logo: widgetShape.shape.logo.default(""),
  collectEmail: widgetShape.shape.collectEmail.default(false),
});

export const widgetCreate = widgetFields.extend({ id: clientId("wgt_").optional() });
export const widgetPatch = widgetShape.partial();

export const settingsPatch = z.object({
  businessName: z.string().trim().min(1).max(120),
  receiveAsset: receiveSymbol,
  branding: z.object({
    accent: hexColor,
    supportEmail: z.union([z.literal(""), z.string().trim().email().max(254)]),
    statementName: z.string().trim().max(60),
  }),
  notifications: z.object({ settled: z.boolean(), processing: z.boolean(), refunded: z.boolean(), expired: z.boolean(), links: z.boolean() }),
  payouts: z.object({
    schedule: z.enum(["daily", "weekly", "manual"]),
    holdDays: z.number().int().min(0).max(90),
    minimumUsd: z.number().min(0).max(100_000_000),
  }).partial(),
  setupDismissed: z.boolean(),
}).partial();

export const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const teamRole = z.enum(["admin", "finance", "viewer"]);
export const webhookEvent = z.enum(["payment.processing", "payment.settled", "payment.refunded", "payment.expired", "payment.failed", "payment.underpaid", "link.created", "payout.sent", "payout.failed"]);

export const webhookCreate = z.object({
  // Whether it's allowed is decided in one place: `assertWebhookUrl`, again at every delivery.
  url: z.string().trim().url("Enter a full URL.").max(2000),
  events: z.array(webhookEvent).min(1, "Pick at least one event."),
});
