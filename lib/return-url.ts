/**
 * The merchant's success URL with the payment it's returning from, so their page can look it up with the
 * API (never trust the query alone: anyone can type it). Their own query and fragment are kept. Null for
 * anything that isn't http or https.
 */
export function returnUrl(successUrl: string, ids: { paymentId: string; sourceId: string }): string | null {
  let url: URL;
  try {
    url = new URL(successUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.searchParams.set("payment_id", ids.paymentId);
  url.searchParams.set("source_id", ids.sourceId);
  return url.toString();
}
