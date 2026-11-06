import { preloadToaster } from "@/components/lazy-toaster";

export const preloadVolumeChart = () => import("./volume-chart");
export const preloadCommandPalette = () => import("./command-palette");
export const preloadPayoutDialog = () => import("./payout-dialog");
export const preloadPaymentDrawer = () => import("./payment-drawer");

/**
 * Overlays and the chart are out of first-load JS, then fetched once the page is idle, so the first
 * open is as instant as the second and a route's first paint never waits for them.
 */
export function preloadDashboardExtras() {
  const run = () => {
    for (const load of [preloadVolumeChart, preloadToaster, preloadCommandPalette, preloadPayoutDialog, preloadPaymentDrawer]) void load();
  };
  // Safari has no requestIdleCallback.
  if (typeof window.requestIdleCallback !== "function") {
    const timer = setTimeout(run, 1500);
    return () => clearTimeout(timer);
  }
  const handle = window.requestIdleCallback(run, { timeout: 4000 });
  return () => window.cancelIdleCallback(handle);
}
