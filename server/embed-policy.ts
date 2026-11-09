import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { log } from "./log";

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; site: string }>();

/** Stored through `siteHost`, and checked again here, because this goes into a response header. */
const SAFE_HOST = /^[a-z0-9.-]+(:\d{1,5})?$/;

export function cspFor(site: string) {
  // A widget with no site set may go anywhere, which is the merchant's choice.
  const ancestors = !site ? "*" : SAFE_HOST.test(site) ? `https://${site} http://${site}` : "'none'";
  return `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors ${ancestors}`;
}

/** Fails `SAFE_HOST`, so `cspFor` answers `frame-ancestors 'none'`. */
const NOT_A_WIDGET = "not a widget";

/** The site a merchant named is the only one that can frame their checkout. */
export async function embedFrameAncestors(id: string) {
  const entry = cache.get(id);
  if (entry && Date.now() - entry.at < TTL_MS) return cspFor(entry.site);
  try {
    const [row] = await db().select({ site: schema.widgets.site }).from(schema.widgets).where(and(eq(schema.widgets.id, id), isNull(schema.widgets.deletedAt))).limit(1);
    // Not a widget (a link, or a deleted widget): no site chose to embed it, so none may.
    const site = row ? row.site : NOT_A_WIDGET;
    if (cache.size > 5000) cache.clear();
    cache.set(id, { at: Date.now(), site });
    return cspFor(site);
  } catch (error) {
    log("error", "embed policy lookup failed", { error });
    return cspFor("invalid host");
  }
}
