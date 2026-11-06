"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";
import { getToasts, subscribeToToasts } from "@/components/base/toast/toast";

const load = () => import("@/components/base/toast/toaster");
const Toaster = dynamic(() => load().then((module) => module.Toaster), { ssr: false });

export const preloadToaster = load;

/**
 * Motion is only used by toasts and the date pickers, so the stack loads with the first toast.
 * It stays mounted after that, for the exit animations. On phones it sits at the top, because the
 * bottom edge is where stacked modal footers and primary actions live.
 */
export function LazyToaster() {
  const hasToast = useSyncExternalStore(subscribeToToasts, () => getToasts().length > 0, () => false);
  const [armed, setArmed] = useState(false);
  if (hasToast && !armed) setArmed(true);
  return armed ? <Toaster className="max-sm:top-3 max-sm:bottom-auto" /> : null;
}
