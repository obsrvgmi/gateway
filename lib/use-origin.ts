"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function useOrigin() {
  return useSyncExternalStore(subscribe, () => window.location.origin, () => "");
}
