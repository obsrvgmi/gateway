import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/base/spinner/spinner";
import { HostedCheckout } from "@/components/checkout/hosted-checkout";

export const metadata: Metadata = { title: "Checkout" };

async function Checkout({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <HostedCheckout id={id} />;
}

export default function PayPage({ params }: PageProps<"/pay/[id]">) {
  return (
    <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner /></div>}>
      <Checkout params={params} />
    </Suspense>
  );
}
