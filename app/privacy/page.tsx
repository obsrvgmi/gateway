import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-[72ch] flex-col gap-3 bg-background-full p-6 text-body-regular text-text-primary">
      <h1 className="text-title-1-semibold">Privacy</h1>
      <p className="text-text-secondary">Draft: this policy has not yet been reviewed by a lawyer.</p>
      <h2 className="pt-4 text-title-3-semibold">What we keep</h2>
      <ul className="flex list-disc flex-col gap-1.5 ps-5">
        <li><strong>Merchants:</strong> email addresses, names, business details, wallet addresses, settings, and a log of account actions.</li>
        <li><strong>Customers:</strong> the wallet address given at checkout, payment amounts and on-chain transaction references, and an email address if the merchant asks for one and you give it.</li>
        <li><strong>Everyone:</strong> IP addresses in security logs and rate limits.</li>
      </ul>
      <h2 className="pt-4 text-title-3-semibold">Who sees it</h2>
      <ul className="flex list-disc flex-col gap-1.5 ps-5">
        <li>The merchant you pay sees your payment details and the wallet you gave.</li>
        <li>NEAR Intents receives the wallet addresses and amounts needed to route a payment, and screens them.</li>
        <li>Wallet addresses and transactions on a public blockchain are public.</li>
        <li>Our infrastructure and email providers process data for us. We may share data where the law requires it.</li>
      </ul>
      <h2 className="pt-4 text-title-3-semibold">What we don&apos;t do</h2>
      <p>We don&apos;t collect identity documents, hold private keys, or sell personal data. There are no advertising trackers on these pages.</p>
      <h2 className="pt-4 text-title-3-semibold">Your choices</h2>
      <p>To ask for a copy of your data or to have it deleted, contact the merchant you paid, or us if you&apos;re a merchant. Payment records may be kept where the law requires it.</p>
    </main>
  );
}
