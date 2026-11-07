import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/base/spinner/spinner";
import { LiveCheckout } from "@/components/checkout/live-checkout";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

async function Embed({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LiveCheckout sourceId={id} />;
}

/** What `/widget.js` frames. Transparent, so the merchant's page shows around the card. */
export default function EmbedPage({ params }: PageProps<"/embed/[id]">) {
  return (
    <main className="flex justify-center bg-transparent p-1">
      <Suspense fallback={<div className="flex min-h-40 items-center justify-center"><Spinner /></div>}>
        <Embed params={params} />
      </Suspense>
    </main>
  );
}
