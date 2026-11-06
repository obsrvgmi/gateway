"use client";

import { preload } from "react-dom";
import { useState } from "react";
import { RiLinkUnlinkM } from "@remixicon/react";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/base/buttons/button";
import { actions, newId, useGateway } from "@/lib/store";
import { CheckoutWidget, type CheckoutResult } from "./checkout-widget";

const MOCK_PAYER = "0x71c2a9f4e83b5d06c1a7e2f9b04d68c3a15e7f29";

export function HostedCheckout({ id }: { id: string }) {
  preload("/guilloche/rosette-hero.svg", { as: "image", crossOrigin: "anonymous", fetchPriority: "high" });
  const [openedAt] = useState(() => Date.now());
  const { links, settings } = useGateway();
  const link = links.find((item) => item.id === id);
  const isExpired = link?.status === "expired" || (link?.expiresAt != null && new Date(link.expiresAt).getTime() < openedAt);

  const record = (result: CheckoutResult) => {
    if (!link) return;
    actions.recordPayment({
      id: newId("pay_"),
      sourceType: "link",
      sourceId: link.id,
      sourceName: link.title,
      payAsset: result.payAsset,
      payAmount: result.payAmount,
      receiveAsset: link.receiveAsset,
      receiveAmount: result.receiveAmount,
      usd: result.usd,
      status: "settled",
      payer: MOCK_PAYER,
      settleSeconds: 24,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <main className="stage is-page relative isolate flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-4">
      <div aria-hidden className="stage-art"><i /></div>
      {link ? (
        <CheckoutWidget
          merchant={settings.businessName}
          title={link.title}
          description={link.description}
          amount={link.amount}
          receiveAsset={link.receiveAsset}
          isDisabled={isExpired || link.status === "paused"}
          disabledMessage={isExpired ? "This link has expired." : "This link is paused."}
          onSettled={record}
          className="stage-card"
          receiptAction={
            link.successUrl ? <ButtonLink href={link.successUrl} variant="secondary" size="small">Return to merchant</ButtonLink> : <span />
          }
        />
      ) : (
        <div className="flex max-w-[360px] flex-col items-center gap-3 stage-card rounded-3xl p-8 text-center">
          <RiLinkUnlinkM className="size-6 text-foreground-icon-secondary" aria-hidden />
          <h1 className="text-headline-semibold">This link isn&apos;t available</h1>
          <p className="text-body-regular text-text-secondary">It may have been deleted. Ask the merchant for a new one.</p>
        </div>
      )}
      <Logo className="relative" />
    </main>
  );
}
