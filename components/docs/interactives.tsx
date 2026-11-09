"use client";

import { useState } from "react";
import { RiCheckboxCircleLine, RiCloseCircleLine, RiTimeLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Textarea } from "@/components/base/textarea/textarea";
import { cx } from "@/utils/cx";
import { C, CodeTabs } from "./primitives";

/* ------------------------------------------------------------------ request builder */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const pad = (depth: number) => "  ".repeat(depth);

function toPython(value: Json, depth = 0): string {
  if (value === null) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "string" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => toPython(item, depth)).join(", ")}]`;
  const entries = Object.entries(value);
  if (!entries.length) return "{}";
  const indent = (level: number) => "    ".repeat(level);
  return `{\n${entries.map(([key, item]) => `${indent(depth + 1)}${JSON.stringify(key)}: ${toPython(item, depth + 1)}`).join(",\n")},\n${indent(depth)}}`;
}

function toPhp(value: Json, depth = 0): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) return `[${value.map((item) => toPhp(item, depth)).join(", ")}]`;
  const entries = Object.entries(value);
  if (!entries.length) return "[]";
  return `[\n${entries.map(([key, item]) => `${pad(depth + 1)}'${key}' => ${toPhp(item, depth + 1)}`).join(",\n")},\n${pad(depth)}]`;
}

const toJs = (value: Json, depth = 0): string => JSON.stringify(value, null, 2).replace(/\n/g, `\n${pad(depth)}`);

const RECEIVE = ["USDC", "USDT", "NEAR", "ETH"] as const;

/** Fill in an order and get the request in four languages. Nothing is sent from here. */
export function LinkBuilder({ baseUrl }: { baseUrl: string }) {
  const [title, setTitle] = useState("Order 1234");
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState("49.00");
  const [receiveAsset, setReceiveAsset] = useState<(typeof RECEIVE)[number]>("USDC");
  const [orderId, setOrderId] = useState("1234");
  const [singleUse, setSingleUse] = useState(true);
  const [successUrl, setSuccessUrl] = useState("https://shop.example/thanks");

  const parsed = Number(amount);
  const amountValue = fixed ? (Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) / 100 : 1) : null;
  const body: { [key: string]: Json } = { title: title.trim() || "Order", amount: amountValue, receiveAsset };
  if (singleUse) body.singleUse = true;
  if (successUrl.trim()) body.successUrl = successUrl.trim();
  if (orderId.trim()) body.metadata = { order_id: orderId.trim() };
  const key = orderId.trim() ? `order-${orderId.trim()}` : "order-1234";
  const url = `${baseUrl}/api/v1/payment-links`;

  const tabs = [
    {
      label: "curl",
      code: `curl ${url} \\
  -H "Authorization: Bearer $GATEWAY_KEY" \\
  -H "Idempotency-Key: ${key}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(body).replace(/'/g, "'\\''")}'`,
    },
    {
      label: "Node",
      code: `const response = await fetch("${url}", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.GATEWAY_KEY}\`,
    "Idempotency-Key": "${key}",
    "Content-Type": "application/json",
  },
  body: JSON.stringify(${toJs(body, 1)}),
});
const link = await response.json();
if (!response.ok) throw new Error(link.error.message);
// Send the customer to link.url`,
    },
    {
      label: "Python",
      code: `import os, requests

response = requests.post(
    "${url}",
    headers={
        "Authorization": f"Bearer {os.environ['GATEWAY_KEY']}",
        "Idempotency-Key": "${key}",
    },
    json=${toPython(body, 1)},
    timeout=10,
)
response.raise_for_status()
link = response.json()
# Send the customer to link["url"]`,
    },
    {
      label: "PHP",
      code: `$ch = curl_init('${url}');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ' . getenv('GATEWAY_KEY'),
    'Idempotency-Key: ${key}',
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode(${toPhp(body, 1)}),
]);
$link = json_decode(curl_exec($ch), true);
// Send the customer to $link['url']`,
    },
  ];

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-border-button-default bg-background-primary-default p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-body-semibold">Build the request</p>
        <p className="text-caption-1-regular text-text-tertiary">Nothing is sent from here.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Title" value={title} onChange={setTitle} hint="The customer sees this." />
        <Input label="Your order id" value={orderId} onChange={setOrderId} hint="Kept as metadata, never shown." />
        <div className="flex flex-col gap-2">
          <span className="text-body-2-medium text-text-secondary">Amount</span>
          <SegmentedControl aria-label="Amount type" selectedKeys={[fixed ? "fixed" : "open"]} onSelectionChange={(keys) => setFixed(keys.has("fixed"))} className="self-start">
            <SegmentedControlItem id="fixed">Fixed, USD</SegmentedControlItem>
            <SegmentedControlItem id="open">Customer sets</SegmentedControlItem>
          </SegmentedControl>
          {fixed && <Input aria-label="Amount in USD" inputMode="decimal" value={amount} onChange={setAmount} />}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-body-2-medium text-text-secondary">You receive</span>
          <SegmentedControl aria-label="You receive" selectedKeys={[receiveAsset]} onSelectionChange={(keys) => setReceiveAsset(([...keys][0] as (typeof RECEIVE)[number]) ?? "USDC")} className="self-start">
            {RECEIVE.map((symbol) => <SegmentedControlItem key={symbol} id={symbol}>{symbol}</SegmentedControlItem>)}
          </SegmentedControl>
        </div>
        <Input label="Success URL" value={successUrl} onChange={setSuccessUrl} hint="Where Return to shop goes. We add payment_id." />
        <div className="flex items-end pb-2">
          <Checkbox isSelected={singleUse} onChange={setSingleUse}>One payment only</Checkbox>
        </div>
      </div>
      <CodeTabs title="Create a payment link" tabs={tabs} />
    </div>
  );
}

/* ------------------------------------------------------------------ signature checker */

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

const SAMPLE_BODY = JSON.stringify({ id: "evt_sample", type: "payment.settled", created_at: "2026-11-09T10:00:00.000Z", data: { id: "pay_sample", status: "settled", live: false, metadata: { order_id: "1234" } } });

type Verdict = { kind: "valid"; age: number } | { kind: "mismatch"; expected: string } | { kind: "malformed"; reason: string };

/**
 * Checks a delivery the way a merchant's server should, in the browser, so a secret pasted here never
 * leaves the page. "Make a sample" produces a correctly signed one, to test a verifier against.
 */
export function SignatureChecker() {
  const [secret, setSecret] = useState("");
  const [header, setHeader] = useState("");
  const [body, setBody] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const sample = async () => {
    if (!globalThis.crypto?.subtle) return setUnsupported(true);
    const made = `whsec_sample_${hex(crypto.getRandomValues(new Uint8Array(12)).buffer)}`;
    const t = Math.floor(Date.now() / 1000);
    setSecret(made);
    setBody(SAMPLE_BODY);
    setHeader(`t=${t},v1=${await hmacHex(made, `${t}.${SAMPLE_BODY}`)}`);
    setVerdict(null);
  };

  const check = async () => {
    if (!globalThis.crypto?.subtle) return setUnsupported(true);
    const parts = Object.fromEntries(header.split(",").map((part) => part.trim().split("=") as [string, string]));
    const t = Number(parts.t);
    if (!parts.t || !Number.isInteger(t)) return setVerdict({ kind: "malformed", reason: "The header needs t=<unix seconds>." });
    if (!/^[0-9a-f]{64}$/.test(parts.v1 ?? "")) return setVerdict({ kind: "malformed", reason: "The header needs v1=<64 hex characters>." });
    if (!secret) return setVerdict({ kind: "malformed", reason: "Paste your endpoint's signing secret." });
    const expected = await hmacHex(secret, `${t}.${body}`);
    setVerdict(expected === parts.v1 ? { kind: "valid", age: Math.round(Date.now() / 1000 - t) } : { kind: "mismatch", expected });
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-border-button-default bg-background-primary-default p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body-semibold">Signature checker</p>
        <p className="text-caption-1-regular text-text-tertiary">Runs in your browser. Nothing is sent.</p>
      </div>
      <Input label="Signing secret" value={secret} onChange={(value) => { setSecret(value); setVerdict(null); }} placeholder="whsec_..." />
      <Input label="Gateway-Signature header" value={header} onChange={(value) => { setHeader(value); setVerdict(null); }} placeholder="t=1763000000,v1=..." />
      <Textarea label="Raw request body, exactly as received" value={body} onChange={(value) => { setBody(value); setVerdict(null); }} rows={4} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={check}>Check</Button>
        <Button variant="secondary" onClick={sample}>Make a sample</Button>
      </div>
      {unsupported && <p className="text-body-regular text-text-error-primary">This browser can&apos;t compute HMACs here. Open the docs over https.</p>}
      {verdict && (
        <div role="status" className={cx("flex items-start gap-2 rounded-2xl px-3 py-2.5", verdict.kind === "valid" ? (verdict.age > 300 ? "bg-status-yellow-background text-status-yellow-text" : "bg-status-lime-background text-status-lime-text") : "bg-status-rose-background text-status-rose-text")}>
          {verdict.kind === "valid" ? (verdict.age > 300 ? <RiTimeLine className="mt-0.5 size-4 shrink-0" aria-hidden /> : <RiCheckboxCircleLine className="mt-0.5 size-4 shrink-0" aria-hidden />) : <RiCloseCircleLine className="mt-0.5 size-4 shrink-0" aria-hidden />}
          <div className="min-w-0 text-body-regular">
            {verdict.kind === "valid" && (verdict.age > 300 ? <>The signature matches, but it was made {Math.round(verdict.age / 60)} minutes ago. Your server should refuse it: anything over five minutes could be a replay.</> : <>Valid. Signed {Math.max(0, verdict.age)} seconds ago, inside the five-minute window.</>)}
            {verdict.kind === "mismatch" && <>Doesn&apos;t match. The body must be byte-for-byte what arrived, before any JSON parsing; the secret is the whole <C>whsec_…</C> string. Expected <C>v1={verdict.expected}</C>.</>}
            {verdict.kind === "malformed" && verdict.reason}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ status map */

export interface StateRow {
  state: string;
  status: string;
  event: string | null;
  meaning: string;
}

const STATUS_ORDER = ["processing", "settled", "refunded", "expired", "failed"];
const STATUS_TONE: Record<string, string> = {
  processing: "bg-status-blue-background text-status-blue-text",
  settled: "bg-status-lime-background text-status-lime-text",
  refunded: "bg-status-purple-background text-status-purple-text",
  expired: "bg-status-yellow-background text-status-yellow-text",
  failed: "bg-status-rose-background text-status-rose-text",
};

/** The five statuses your code branches on, with the finer states behind each. Pick one to read it. */
export function StatusMap({ states }: { states: StateRow[] }) {
  const [picked, setPicked] = useState("settled");
  const current = states.find((row) => row.state === picked) ?? states[0];
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-border-button-default bg-background-primary-default p-4">
      <p className="text-body-semibold">Status map</p>
      <div className="grid gap-2 sm:grid-cols-5">
        {STATUS_ORDER.map((status) => (
          <div key={status} className="flex flex-col gap-1.5">
            <span className={cx("self-start rounded-md px-1.5 py-0.5 text-caption-1-semibold", STATUS_TONE[status])}>{status}</span>
            <div className="flex flex-wrap gap-1 sm:flex-col">
              {states.filter((row) => row.status === status).map((row) => (
                <button
                  key={row.state}
                  type="button"
                  aria-pressed={row.state === current.state}
                  onClick={() => setPicked(row.state)}
                  className={cx("rounded-lg border px-2 py-1 text-start font-mono text-caption-1-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring", row.state === current.state ? "border-border-button-hover bg-background-secondary-default text-text-primary" : "border-border-button-default text-text-secondary hover:text-text-primary")}
                >
                  {row.state}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1 rounded-2xl bg-background-secondary-default px-3 py-2.5" aria-live="polite">
        <p className="text-body-2-semibold">
          <C>{current.state}</C> is <C>{current.status}</C>
          {current.event ? <> and sends <C>{current.event}</C></> : <>, with no webhook of its own</>}
        </p>
        <p className="text-body-regular text-text-secondary">{current.meaning}</p>
      </div>
    </div>
  );
}
