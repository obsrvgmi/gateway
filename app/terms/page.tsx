import type { Metadata } from "next";
import { TERMS_VERSION } from "@/lib/site";

export const metadata: Metadata = { title: "Terms" };

const H = ({ children, id }: { children: React.ReactNode; id?: string }) => <h2 id={id} className="pt-4 text-title-3-semibold">{children}</h2>;

export default function TermsPage() {
  return (
    <main className="mx-auto flex max-w-[72ch] flex-col gap-3 bg-background-full p-6 text-body-regular text-text-primary">
      <h1 className="text-title-1-semibold">Terms</h1>
      <p className="text-text-secondary">Version {TERMS_VERSION}. Draft: these terms have not yet been reviewed by a lawyer.</p>

      <H>What Gateway is</H>
      <p>Gateway is non-custodial software for accepting crypto payments. We never hold your funds or your keys. Payments are routed by NEAR Intents, a third-party service we don&apos;t control. A customer&apos;s deposit goes to a one-time address issued by that service, and the output goes to an account or wallet controlled by your own key.</p>

      <H id="merchants">Merchants</H>
      <p>By using Gateway to take payments, you agree that:</p>
      <ul className="flex list-disc flex-col gap-1.5 ps-5">
        <li><strong>Your compliance is your responsibility.</strong> Your business is solely responsible for its own know-your-customer and anti-money-laundering checks, sanctions compliance, tax, and for holding any licence or registration your activity requires in every place you operate.</li>
        <li><strong>Regulatory requests are yours to answer.</strong> Your business is responsible for responding to any government or regulatory audit or inquiry about your activity, and for keeping the records it requires. You&apos;ll give us what we reasonably need to meet our own legal obligations and those of our providers.</li>
        <li><strong>You control your keys.</strong> If you lose your settlement wallet, we can&apos;t recover your funds. Only your wallet can move your settlement balance.</li>
        <li><strong>Prohibited uses.</strong> You won&apos;t use Gateway for anything illegal, including fraud, money laundering, terrorist financing or evading sanctions, or for customers in comprehensively sanctioned places. You won&apos;t route funds through mixers or intermediaries that hide who is paying.</li>
        <li><strong>Refunds are yours to give.</strong> A refund window is a setting in our software, not a guarantee. On-chain, your wallet can always move your funds.</li>
      </ul>

      <H id="customers">Customers paying a merchant</H>
      <ul className="flex list-disc flex-col gap-1.5 ps-5">
        <li><strong>Who you&apos;re paying.</strong> Your purchase is with the merchant. Questions about what you bought go to them.</li>
        <li><strong>Crypto payments are final.</strong> We can&apos;t reverse a payment. Sending the wrong asset, using the wrong network, omitting a required memo, or sending after the deadline may lose your funds permanently.</li>
        <li><strong>Refunds and returned deposits.</strong> If a payment can&apos;t complete, your deposit is returned to the wallet you gave, less a network fee, by the routing service. A refund from a merchant is at the merchant&apos;s discretion. Wallets on an exchange may not receive returned funds, so use a wallet you control.</li>
        <li><strong>Screening.</strong> Wallets may be checked against sanctions lists, by us and by the routing service. A payment may be refused, delayed or held as a result.</li>
      </ul>

      <H>Risks</H>
      <p>Using crypto involves risk. Prices move. Networks and third-party services, including NEAR Intents and the bridges it uses, can fail, pause, be exploited, or hold funds for compliance reasons. While funds sit in a NEAR Intents balance, you carry that service&apos;s risk. Straight-to-wallet settlement avoids holding a balance there.</p>

      <H>Disclaimers</H>
      <p>Gateway is provided as is. To the extent the law allows, we aren&apos;t liable for losses caused by networks, third-party services, your wallet or your keys, or by your use of the software. Nothing here limits liability that can&apos;t legally be limited. We may suspend the service or any route to protect users or to comply with the law.</p>
    </main>
  );
}
