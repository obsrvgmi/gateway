import { z } from "zod";
import { ONE_CLICK_QUOTE_KEY, VERIFIER_CONTRACT } from "@/lib/intents";
import { generatedIntent, ProviderRejected, ProviderUnavailable, quoteResponse, statusResponse, submittedIntent, tokenInfo, type QuoteRequest, type SwapProvider } from "./types";

const TIMEOUT_MS = 20_000;

export interface OneClickConfig {
  baseUrl: string;
  apiKey?: string;
  nearRpcUrl: string;
}

export class OneClickProvider implements SwapProvider {
  readonly kind = "oneclick" as const;
  readonly quoteKey = ONE_CLICK_QUOTE_KEY;

  constructor(private readonly config: OneClickConfig) {}

  private async call<T extends z.ZodType>(method: string, path: string, schema: T, body?: unknown): Promise<z.output<T>> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(this.config.apiKey ? { "X-API-Key": this.config.apiKey } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderUnavailable(`Provider request failed: ${(error as Error).message}`);
    }
    const text = await response.text();
    if (response.status >= 500 || response.status === 429) throw new ProviderUnavailable(`Provider returned ${response.status}`);
    if (!response.ok) {
      let message = `Provider returned ${response.status}`;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {
        // Keep the status line.
      }
      throw new ProviderRejected(response.status, message);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ProviderUnavailable("Provider returned something other than JSON");
    }
    const result = schema.safeParse(parsed);
    if (!result.success) throw new ProviderUnavailable(`Provider response had an unexpected shape: ${result.error.issues[0]?.path.join(".")} ${result.error.issues[0]?.message}`);
    return result.data;
  }

  tokens() {
    return this.call("GET", "/v0/tokens", z.array(tokenInfo));
  }

  quote(request: QuoteRequest) {
    return this.call("POST", "/v0/quote", quoteResponse, request);
  }

  status(depositAddress: string, depositMemo?: string | null) {
    const query = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
    return this.call("GET", `/v0/status?${query}`, statusResponse);
  }

  async submitDeposit(input: { txHash: string; depositAddress: string; depositMemo?: string | null }) {
    await this.call("POST", "/v0/deposit/submit", z.unknown(), { txHash: input.txHash, depositAddress: input.depositAddress, ...(input.depositMemo ? { memo: input.depositMemo } : {}) });
  }

  generateIntent(input: { signerId: string; depositAddress: string }) {
    return this.call("POST", "/v0/generate-intent", generatedIntent, { type: "swap_transfer", standard: "erc191", signerId: input.signerId, depositAddress: input.depositAddress });
  }

  submitIntent(input: { payload: string; signature: string }) {
    return this.call("POST", "/v0/submit-intent", submittedIntent, { type: "swap_transfer", signedData: { standard: "erc191", payload: input.payload, signature: input.signature } });
  }

  async balances(account: string, assetIds: string[]): Promise<string[]> {
    const args = Buffer.from(JSON.stringify({ account_id: account, token_ids: assetIds })).toString("base64");
    let response: Response;
    try {
      response = await fetch(this.config.nearRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "balance", method: "query", params: { request_type: "call_function", finality: "final", account_id: VERIFIER_CONTRACT, method_name: "mt_batch_balance_of", args_base64: args } }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new ProviderUnavailable(`NEAR RPC failed: ${(error as Error).message}`);
    }
    if (!response.ok) throw new ProviderUnavailable(`NEAR RPC returned ${response.status}`);
    const json = (await response.json()) as { result?: { result?: number[] } };
    if (!json.result?.result) throw new ProviderUnavailable("NEAR RPC returned no result");
    const balances = z.array(z.string().regex(/^\d+$/)).length(assetIds.length).parse(JSON.parse(Buffer.from(json.result.result).toString("utf8")));
    return balances;
  }
}
