import "server-only";
import type { NextRequest } from "next/server";
import { env } from "../env";
import { HttpError } from "../http/errors";
import { clientIp } from "../http/route";
import { rateLimit } from "../http/rate-limit";

/** Public endpoints have no login, so each is limited by address, and by source so one page can't be drained. */
export async function limitCheckout(request: NextRequest, bucket: string, perIp: number, sourceId?: string) {
  if (sourceId) return rateLimit(`checkout:${bucket}:src:${sourceId}`, perIp * 20, 60);
  const ip = clientIp(request);
  if (ip) await rateLimit(`checkout:${bucket}:ip:${ip}`, perIp, 60);
}

/** Only works where the CDN in front of the app reports a country. See `GEO_COUNTRY_HEADER`. */
export function assertCountryAllowed(request: NextRequest) {
  const { GEO_COUNTRY_HEADER, BLOCKED_COUNTRIES } = env();
  if (!GEO_COUNTRY_HEADER) return;
  const country = request.headers.get(GEO_COUNTRY_HEADER)?.toUpperCase();
  if (country && BLOCKED_COUNTRIES.split(",").map((code) => code.trim().toUpperCase()).includes(country)) {
    throw new HttpError(451, "region_blocked", "Payments aren't available in your region.");
  }
}
