/**
 * Proves our ERC-191 encoding reaches `intents.near` correctly, without funds: a transfer signed by a
 * throwaway key, sent to `simulate_intents`. A rejected signature and an empty balance fail differently.
 *
 *   npx tsx test/live/simulate-intent.ts
 */
import { randomBytes } from "node:crypto";
import { base58 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";
import { encodeErc191Signature } from "../../lib/intents";

const RPC = process.env.NEAR_RPC_URL ?? "https://rpc.mainnet.near.org";

async function simulate(signed: unknown) {
  const args = Buffer.from(JSON.stringify({ signed: [signed] })).toString("base64");
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "query", params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "simulate_intents", args_base64: args } }),
  });
  const json = (await response.json()) as { result?: { result?: number[]; error?: string }; error?: unknown };
  if (json.result?.result) return Buffer.from(json.result.result).toString("utf8");
  return json.result?.error ?? JSON.stringify(json.error);
}

const key = `0x${randomBytes(32).toString("hex")}` as const;
const account = privateKeyToAccount(key);
const payload = JSON.stringify({
  verifying_contract: "intents.near",
  signer_id: account.address.toLowerCase(),
  deadline: new Date(Date.now() + 300_000).toISOString(),
  nonce: Buffer.from(randomBytes(32)).toString("base64"),
  intents: [{ intent: "transfer", receiver_id: "6bde74f40cc2df0269fbf068cd3fb9898c2c6c959bf2f83185d86d2a95653c0a", tokens: { "nep141:wrap.near": "1" } }],
});

async function main() {
  const good = await account.signMessage({ message: payload });
  const encoded = encodeErc191Signature(good);
  console.log("signer ", account.address.toLowerCase());
  console.log("A) correct encoding:", (await simulate({ standard: "erc191", payload, signature: encoded })).slice(0, 400));

  // Control: the same bytes with v left at 27/28 must be refused, or this test proves nothing.
  const raw = Buffer.from(good.slice(2), "hex");
  console.log("B) v not normalized:", (await simulate({ standard: "erc191", payload, signature: `secp256k1:${base58.encode(raw)}` })).slice(0, 300));

  // Control: a signature for different text recovers a different key, so it can't spend this account.
  const other = encodeErc191Signature(await account.signMessage({ message: `${payload} ` }));
  console.log("C) wrong message    :", (await simulate({ standard: "erc191", payload, signature: other })).slice(0, 300));
}

void main();
