import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Developer docs" };

const Code = ({ children }: { children: string }) => <pre dir="ltr" className="overflow-x-auto rounded-xl bg-background-secondary-default p-3 text-caption-1-regular"><code>{children}</code></pre>;
const H = ({ children, id }: { children: ReactNode; id: string }) => <h2 id={id} className="scroll-mt-4 pt-6 text-title-2-semibold">{children}</h2>;

export default function DocsPage() {
  return (
    <main className="mx-auto flex max-w-[80ch] flex-col gap-3 bg-background-full p-6 text-body-regular text-text-primary">
      <h1 className="text-title-1-semibold">Developer docs</h1>
      <p className="text-text-secondary">Take crypto with a link or an embedded checkout, and hear about payments on your server. API keys are created under Settings, Developers.</p>

      <H id="widget">Embed a checkout</H>
      <p>Paste this where the checkout should appear. It renders in an iframe, so your page never touches a customer&apos;s wallet. Its look and rules come from your dashboard, so saved changes apply everywhere it&apos;s embedded.</p>
      <Code>{`<script src="https://YOUR-GATEWAY/widget.js" data-widget="wgt_..." async></script>`}</Code>
      <p>Or, in React:</p>
      <Code>{`import { GatewayWidget } from "@gateway/react";

<GatewayWidget id="wgt_..." baseUrl="https://YOUR-GATEWAY" onSettled={(id) => console.log(id)} />`}</Code>
      <p>Browser events are for your interface only. <strong>Don&apos;t fulfil an order from them</strong>, because they run on the customer&apos;s machine. Use a signed webhook.</p>

      <H id="api">REST API</H>
      <p>Send your key as a bearer token. A key can read payments and manage payment links. It can never move funds, because that takes your wallet&apos;s signature.</p>
      <Code>{`curl https://YOUR-GATEWAY/api/v1/payment-links \\
  -H "Authorization: Bearer gw_live_..." \\
  -H "Idempotency-Key: order-1234" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Order 1234","amount":49.00,"receiveAsset":"USDC"}'`}</Code>
      <table className="w-full text-start">
        <tbody className="divide-y divide-separator-border">
          {[
            ["POST /api/v1/payment-links", "Create a link. Returns its url. Send an Idempotency-Key so a retry can't create two."],
            ["GET /api/v1/payment-links", "List links."],
            ["GET, PATCH, DELETE /api/v1/payment-links/:id", "Read, change or delete a link."],
            ["GET /api/v1/payments?limit=&before=", "List payments, newest first. Pass the last created_at as before for the next page."],
            ["GET /api/v1/payments/:id", "Read a payment."],
            ["GET /api/v1/payouts", "List payouts."],
          ].map(([route, detail]) => (
            <tr key={route}><td dir="ltr" className="py-2 pe-3 align-top text-caption-1-medium whitespace-nowrap">{route}</td><td className="py-2">{detail}</td></tr>
          ))}
        </tbody>
      </table>
      <p>Errors are <code>{`{"error":{"code","message"}}`}</code> with a matching HTTP status. Keys are limited to 600 requests a minute.</p>

      <H id="webhooks">Webhooks</H>
      <p>Add an endpoint under Settings, Developers. Each event is a POST with these headers. We retry for about a day, at growing intervals, until you return a 2xx. Deliveries can repeat or arrive out of order, so de-duplicate on the event id and read the status from the event, or from the API.</p>
      <Code>{`Gateway-Event: payment.settled
Gateway-Event-Id: evt_123
Gateway-Signature: t=1763000000,v1=<hex hmac>

{"id":"evt_123","type":"payment.settled","created_at":"…","data":{"id":"pay_…","status":"settled","live":true,"amount_usd":49,
 "pay":{"asset":"ETH","chain":"Ethereum","amount_base":"…","decimals":18},
 "receive":{"asset":"USDC","chain":"Base","amount_base":"49000000","decimals":6},"payer":"0x…"}}`}</Code>
      <p>Check the signature before trusting an event. It&apos;s an HMAC-SHA256 of <code>{`t + "." + rawBody`}</code> using your endpoint&apos;s signing secret. Refuse an old timestamp, so a captured request can&apos;t be replayed.</p>
      <Code>{`import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  const given = Buffer.from(v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}`}</Code>
      <p>Events: <code>payment.processing</code>, <code>payment.settled</code>, <code>payment.refunded</code>, <code>payment.expired</code>, <code>payment.failed</code>, <code>payout.sent</code>, <code>payout.failed</code>, <code>link.created</code>, and a <code>ping</code> from the test button.</p>
      <p>Amounts in <code>amount_base</code> are integer strings in the asset&apos;s smallest unit. Read them as big integers, not floats. Check <code>live</code>, so test-mode events can&apos;t fulfil real orders. <code>payment.expired</code> isn&apos;t final: if money arrives late, <code>payment.settled</code> can still follow.</p>

      <H id="test-mode">Test mode</H>
      <p>Until live payments are switched on, the whole system runs with a simulated route. Checkout offers buttons that act as the customer&apos;s payment, including underpaying and failing, and events carry <code>{`"live": false`}</code>. No funds move and no real network is used.</p>
    </main>
  );
}
