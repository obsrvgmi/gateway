"use client";

import Link from "next/link";
import { preload } from "react-dom";
import { Logo } from "@/components/brand/logo";
import { LiveCheckout } from "./live-checkout";

export function HostedCheckout({ id }: { id: string }) {
  preload("/guilloche/rosette-hero.svg", { as: "image", crossOrigin: "anonymous", fetchPriority: "high" });
  return (
    <main className="stage is-page relative isolate flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-4">
      <div aria-hidden className="stage-art"><i /></div>
      <LiveCheckout sourceId={id} />
      <Link href="/" aria-label="Gateway" className="opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-border-focus-ring"><Logo /></Link>
    </main>
  );
}
