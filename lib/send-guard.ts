"use client";

export type SendRecord = { state: "none" } | { state: "pending" } | { state: "sent"; txHash: string };

const PENDING = "pending";

/**
 * Remembers in this browser that a wallet was asked to send. The server only hears after the wallet
 * answers, so a reload during the prompt, or a lost report afterwards, would otherwise offer the send again.
 */
export function sendGuard(id: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = typeof window === "undefined" ? null : window.localStorage) {
  const key = `gateway:send:${id}`;
  const attempt = (action: () => void) => {
    try {
      action();
    } catch {
      // Private windows can refuse storage. The server's record still applies.
    }
  };
  return {
    begin: () => attempt(() => storage?.setItem(key, PENDING)),
    done: (txHash: string) => attempt(() => storage?.setItem(key, txHash)),
    clear: () => attempt(() => storage?.removeItem(key)),
    read(): SendRecord {
      try {
        const value = storage?.getItem(key);
        if (!value) return { state: "none" };
        return value === PENDING ? { state: "pending" } : { state: "sent", txHash: value };
      } catch {
        return { state: "none" };
      }
    },
  };
}
