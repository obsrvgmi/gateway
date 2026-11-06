import { failedPayouts } from "./payouts";
import { formatUsdWhole } from "./format";
import type { GatewayState } from "./types";

const DAY = 86_400_000;

export interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: "critical" | "warning" | "info";
}

/** What the merchant should act on, most urgent first. Every item links to where it gets fixed. */
export function attentionItems({ links, widgets, payments, payouts, settings }: GatewayState, now: number): AttentionItem[] {
  const items: AttentionItem[] = [];
  const failed = failedPayouts(payouts);
  if (failed.length) {
    items.push({ id: "payouts", title: `${failed.length} payout${failed.length === 1 ? "" : "s"} failed`, detail: `${formatUsdWhole(failed.reduce((sum, payout) => sum + payout.usd, 0))} is back in your balance. Retry when ready.`, href: "/dashboard/payouts", tone: "critical" });
  }
  const week = payments.filter((p) => new Date(p.createdAt).getTime() >= now - 7 * DAY);
  const expired = week.filter((p) => p.status === "expired");
  const resolved = week.filter((p) => p.status !== "processing").length;
  if (expired.length >= 2 && resolved) {
    items.push({ id: "expired", title: `${expired.length} quotes expired this week`, detail: `${formatUsdWhole(expired.reduce((sum, p) => sum + p.usd, 0))} of checkouts never finished.`, href: "/dashboard/payments?status=expired&range=7", tone: "warning" });
  }
  for (const link of links) {
    if (link.status !== "active" || !link.expiresAt) continue;
    const left = Math.ceil((new Date(link.expiresAt).getTime() - now) / DAY);
    if (left > 0 && left <= 21) items.push({ id: link.id, title: `${link.title} expires in ${left} day${left === 1 ? "" : "s"}`, detail: "Extend it or it stops taking payments.", href: `/dashboard/links/${link.id}/edit`, tone: "warning" });
  }
  for (const widget of widgets) {
    if (widget.status === "paused") items.push({ id: widget.id, title: `${widget.name} is paused`, detail: "Its checkout is not taking payments.", href: "/dashboard/widgets", tone: "info" });
  }
  const offHook = settings.webhooks.find((hook) => !hook.enabled);
  if (offHook) items.push({ id: "webhook", title: "A webhook is turned off", detail: "Your server won't hear about payments at that endpoint.", href: "/dashboard/settings?tab=developers", tone: "info" });
  const invited = settings.team.filter((member) => member.status === "invited").length;
  if (invited) items.push({ id: "team", title: `${invited} invitation${invited === 1 ? "" : "s"} waiting`, detail: "A teammate hasn't joined yet.", href: "/dashboard/settings?tab=team", tone: "info" });
  return items;
}
