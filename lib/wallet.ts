"use client";

import { encodeFunctionData, toHex } from "viem";
import type { Asset } from "./assets";

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

interface Announced {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: Eip1193;
}

const announced = new Map<string, Announced>();

/** EIP-6963: wallets announce themselves, so one extension can't claim `window.ethereum` over another. */
function listen() {
  if (typeof window === "undefined") return;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const { detail } = event as CustomEvent<Announced>;
    announced.set(detail.info.uuid, detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
listen();

export class WalletError extends Error {}

function provider(): Eip1193 {
  const [first] = announced.values();
  const injected = first?.provider ?? (window as unknown as { ethereum?: Eip1193 }).ethereum;
  if (!injected) throw new WalletError("No browser wallet found. Install one such as MetaMask or Rabby, then try again.");
  return injected;
}

const friendly = (error: unknown) => {
  const { code, message } = error as { code?: number; message?: string };
  if (code === 4001) return new WalletError("You declined this in your wallet.");
  return new WalletError(message ?? "Your wallet couldn't complete this.");
};

export const hasWallet = () => typeof window !== "undefined" && (announced.size > 0 || Boolean((window as unknown as { ethereum?: unknown }).ethereum));

/** Asks the wallet which account to use. Lowercase, the form the server keeps. */
export async function connectWallet(): Promise<string> {
  try {
    const accounts = (await provider().request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts[0]) throw new WalletError("Your wallet didn't share an account.");
    return accounts[0].toLowerCase();
  } catch (error) {
    throw error instanceof WalletError ? error : friendly(error);
  }
}

/** Signs text with the given account. The wallet shows the text to the person signing. */
export async function signMessage(address: string, message: string): Promise<string> {
  try {
    return (await provider().request({ method: "personal_sign", params: [toHex(message), address] })) as string;
  } catch (error) {
    throw friendly(error);
  }
}

const ERC20_TRANSFER = [{ type: "function", name: "transfer", stateMutability: "nonpayable", inputs: [{ name: "to", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }] }] as const;

/**
 * Sends a deposit from the connected account. Checks the chain first: a transfer on the wrong chain
 * can't reach the deposit address and may be lost.
 */
export async function sendDeposit(input: { asset: Asset; to: string; amountBase: string; from: string }): Promise<string> {
  const { evm } = input.asset;
  if (!evm) throw new WalletError(`${input.asset.symbol} can't be paid from a browser wallet here. Send it from your wallet app.`);
  const wallet = provider();
  try {
    const current = Number.parseInt((await wallet.request({ method: "eth_chainId" })) as string, 16);
    if (current !== evm.chainId) {
      await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: toHex(evm.chainId) }] });
      const after = Number.parseInt((await wallet.request({ method: "eth_chainId" })) as string, 16);
      if (after !== evm.chainId) throw new WalletError(`Switch your wallet to ${input.asset.chain} and try again.`);
    }
    const amount = BigInt(input.amountBase);
    const transaction = evm.contract
      ? { from: input.from, to: evm.contract, data: encodeFunctionData({ abi: ERC20_TRANSFER, functionName: "transfer", args: [input.to as `0x${string}`, amount] }) }
      : { from: input.from, to: input.to, value: toHex(amount) };
    return (await wallet.request({ method: "eth_sendTransaction", params: [transaction] })) as string;
  } catch (error) {
    throw error instanceof WalletError ? error : friendly(error);
  }
}
