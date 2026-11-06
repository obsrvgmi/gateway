import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import { hexToString, type Hex } from "viem";
import { RECEIVER_PORT, signaturesMatch, SITE_PORT, stackPaths } from "./support/stack";

const merchantWallet = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const CUSTOMER_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const EMAIL = `owner-${Date.now()}@example.com`;

/** A browser wallet that signs for real with a throwaway key, so the server's checks run on real signatures. */
async function installWallet(context: BrowserContext) {
  await context.exposeFunction("__walletSign", async (hexMessage: string) => merchantWallet.signMessage({ message: hexToString(hexMessage as Hex) }));
  await context.addInitScript((address) => {
    let chain = "0x1";
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "personal_sign") return (window as unknown as { __walletSign(m: unknown): Promise<string> }).__walletSign((params as unknown[])[0]);
        if (method === "eth_chainId") return chain;
        if (method === "wallet_switchEthereumChain") {
          chain = (params as { chainId: string }[])[0].chainId;
          return null;
        }
        if (method === "eth_sendTransaction") return `0x${"ab".repeat(32)}`;
        throw new Error(`Unexpected wallet call: ${method}`);
      },
    };
    (window as unknown as { ethereum: unknown }).ethereum = provider;
  }, merchantWallet.address);
}

function latestEmail(to: string) {
  const lines = readFileSync(stackPaths.emails, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { to: string; subject: string; text: string });
  return lines.filter((line) => line.to === to).at(-1);
}

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const mail = latestEmail(email);
  const link = /http\S+\/login\/verify\S+/.exec(mail?.text ?? "")?.[0];
  expect(link, "the sign-in email has a link").toBeTruthy();
  await page.goto(link as string);
}

let merchant: Page;
let linkUrl = "";
let secret = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext();
  await installWallet(context);
  merchant = await context.newPage();
});

test("a dashboard visitor without a session goes to sign-in", async ({ page }) => {
  await page.goto("/dashboard/payments");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("a merchant signs up by email and sets up a workspace", async () => {
  await signIn(merchant, EMAIL);
  await expect(merchant).toHaveURL(/\/onboarding/);
  await merchant.getByLabel("Your name").fill("Asha");
  await merchant.getByLabel("Business name").fill("Lumen Studio");
  // React Aria hides the real input, so click the label the way a person does.
  await merchant.getByText("I accept the").click();
  await merchant.getByRole("button", { name: "Continue" }).click();
  await expect(merchant).toHaveURL(/\/dashboard$/);
  await expect(merchant.getByText("Test mode").first()).toBeVisible();
});

test("a sign-in link works once", async ({ page }) => {
  const link = /http\S+\/login\/verify\S+/.exec(latestEmail(EMAIL)?.text ?? "")?.[0];
  await page.goto(link as string);
  await expect(page.getByRole("heading", { name: "This link didn't work" })).toBeVisible();
});

test("a sign-in link opened in another browser asks first, and doesn't sign in silently", async ({ browser }) => {
  const asker = await browser.newContext();
  const page = await asker.newPage();
  const address = `other-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  const link = /http\S+\/login\/verify\S+/.exec(latestEmail(address)?.text ?? "")?.[0];

  const victim = await browser.newContext();
  const other = await victim.newPage();
  await other.goto(link as string);
  await expect(other.getByRole("heading", { name: "Is this your account?" })).toBeVisible();
  expect((await victim.cookies()).some((cookie) => cookie.name === "gw_session")).toBe(false);
  await asker.close();
  await victim.close();
});

test("checkout stays closed until a settlement wallet is connected", async () => {
  await merchant.goto("/dashboard/links/new");
  await merchant.getByLabel("Title").fill("Brand sprint deposit");
  await merchant.getByRole("button", { name: "Next" }).click();
  await merchant.getByRole("button", { name: "Create link" }).click();
  await expect(merchant.getByRole("heading", { name: "Your link is live" })).toBeVisible();
  linkUrl = (await merchant.locator("div[dir=ltr]").filter({ hasText: "/pay/" }).first().textContent()) ?? "";
  expect(linkUrl).toContain("/pay/lnk_");

  const customer = await merchant.context().browser()!.newContext();
  const page = await customer.newPage();
  await page.goto(linkUrl);
  await expect(page.getByText("This merchant isn't ready to take payments yet.")).toBeVisible();
  await customer.close();
});

test("the merchant connects a settlement wallet by signing", async () => {
  await merchant.goto("/dashboard/settings");
  await merchant.getByRole("button", { name: "Connect wallet" }).click();
  await merchant.getByRole("button", { name: "Connect and sign" }).click();
  await expect(merchant.getByText(merchantWallet.address.toLowerCase()).first()).toBeVisible();
});

test("a webhook endpoint can be added, and its secret is shown once", async () => {
  await merchant.goto("/dashboard/settings?tab=developers");
  await merchant.getByRole("button", { name: "Add endpoint" }).click();
  await merchant.getByLabel("Endpoint URL").fill(`http://localhost:${RECEIVER_PORT}/hook`);
  for (const name of ["payment.processing", "payment.refunded", "payout.sent"]) await merchant.getByText(name, { exact: true }).click();
  await merchant.getByRole("button", { name: "Add endpoint" }).last().click();
  secret = (await merchant.locator("pre").filter({ hasText: "whsec_" }).textContent()) ?? "";
  expect(secret).toMatch(/^whsec_/);
  await merchant.getByRole("button", { name: "Done" }).click();
});

test("a customer in another browser opens the link and pays", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(linkUrl);
  await expect(page.getByRole("heading", { name: "Brand sprint deposit" })).toBeVisible();

  await page.getByRole("radio", { name: "Ether on Ethereum" }).check({ force: true });
  await expect(page.getByText(/ETH$/).first()).toBeVisible();
  await page.getByLabel(/Your Ethereum wallet/).fill("not an address");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await expect(page.getByText("Enter an EVM wallet address.")).toBeVisible();
  await page.getByLabel(/Your Ethereum wallet/).fill(CUSTOMER_WALLET);
  await page.getByRole("button", { name: "Continue to payment" }).click();

  await expect(page.getByText("Send exactly")).toBeVisible();
  await expect(page.getByText(/^sim_/).first()).toBeVisible();

  // A reload must show the same address, never a second one to pay.
  const address = await page.getByText(/^sim_/).first().textContent();
  await page.reload();
  await expect(page.getByText("Send exactly")).toBeVisible();
  expect(await page.getByText(/^sim_/).first().textContent()).toBe(address);

  await page.getByRole("button", { name: "Simulate payment" }).click();
  await expect(page.getByText("Payment complete")).toBeVisible({ timeout: 60_000 });
  await context.close();
});

test("the payment reaches the dashboard, and the balance is really there", async () => {
  await merchant.goto("/dashboard/payments");
  await expect(merchant.getByText("Brand sprint deposit").first()).toBeVisible();
  await expect(merchant.getByText("Settled").first()).toBeVisible();
  await merchant.goto("/dashboard/payouts");
  await expect(merchant.getByRole("heading", { name: "Available to pay out" })).toBeVisible();
  await expect(merchant.getByRole("button", { name: "Pay out now" })).toBeEnabled();
});

test("the webhook arrived, correctly signed", async () => {
  await expect.poll(() => readFileSync(stackPaths.webhooks, "utf8"), { timeout: 30_000 }).toContain("payment.settled");
  const events = readFileSync(stackPaths.webhooks, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { signature: string; type: string; body: string });
  const settled = events.find((event) => event.type === "payment.settled");
  expect(signaturesMatch(settled!.body, settled!.signature, secret)).toBe(true);
  expect(signaturesMatch(settled!.body, settled!.signature, "whsec_wrong")).toBe(false);
  const data = JSON.parse(settled!.body).data as { live: boolean; receive: { amount_base: string } };
  expect(data.live).toBe(false);
  // The link form defaults to $250, and USDC has 6 decimals.
  expect(data.receive.amount_base).toBe("250000000");
});

test("the merchant pays out with a wallet signature", async () => {
  await merchant.goto("/dashboard/payouts");
  await merchant.getByRole("button", { name: "Pay out now" }).click();
  await merchant.getByRole("button", { name: "Continue" }).click();
  await expect(merchant.getByRole("heading", { name: "Check and sign" })).toBeVisible();
  await merchant.getByRole("button", { name: "Sign in wallet" }).click();
  await expect(merchant.getByRole("heading", { name: "Payout sent" })).toBeVisible({ timeout: 60_000 });
  await merchant.getByRole("button", { name: "Done" }).click();
  await expect(merchant.getByText("Sent").first()).toBeVisible();
});

test("an embedded widget takes a payment on another site", async ({ browser }) => {
  await merchant.goto("/dashboard/widgets/new");
  await merchant.getByRole("button", { name: /Save/ }).first().click();
  await expect(merchant.getByRole("button", { name: "Copy code" })).toBeEnabled();
  const code = await merchant.locator("pre code").first().textContent();
  const widgetId = /wgt_[a-z0-9]+/.exec(code ?? "")?.[0];
  expect(widgetId).toBeTruthy();

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://localhost:${SITE_PORT}/?widget=${widgetId}`);
  const frame = page.frameLocator("iframe");
  await frame.getByRole("radio", { name: "Ether on Ethereum" }).check({ force: true });
  await frame.getByLabel(/Your Ethereum wallet/).fill(CUSTOMER_WALLET);
  await frame.getByRole("button", { name: /Pay|Continue/ }).click();
  await frame.getByRole("button", { name: "Simulate payment" }).click();
  await expect(frame.getByText("Payment complete")).toBeVisible({ timeout: 60_000 });
  // The site hears about it, for its interface.
  await expect(page.locator("#events")).toContainText("settled:pay_");
  await context.close();
});

async function customerPays() {
  const context = await merchant.context().browser()!.newContext();
  const page = await context.newPage();
  await page.goto(linkUrl);
  await page.getByRole("radio", { name: "Ether on Ethereum" }).check({ force: true });
  await page.getByLabel(/Your Ethereum wallet/).fill(CUSTOMER_WALLET);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: "Simulate payment" }).click();
  await expect(page.getByText("Payment complete")).toBeVisible({ timeout: 60_000 });
  await context.close();
}

/** The newest payment's drawer, once its refund button is there. */
async function openNewestRefund() {
  await expect(async () => {
    await merchant.goto("/dashboard/payments");
    await merchant.getByRole("row", { name: /Brand sprint deposit/ }).first().click();
    await expect(merchant.getByRole("button", { name: "Refund", exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  await merchant.getByRole("button", { name: "Refund", exact: true }).click();
  await merchant.getByRole("button", { name: "Continue" }).click();
}

test("a refund from the balance is checked in the browser and signed by the wallet", async () => {
  await customerPays();
  await openNewestRefund();
  await expect(merchant.getByRole("heading", { name: "Check and sign" })).toBeVisible();
  // The drawer behind it names the wallet too.
  await expect(merchant.getByText("Customer's wallet").last()).toBeVisible();
  await merchant.getByRole("button", { name: "Sign in wallet" }).click();
  await expect(merchant.getByText("Refund on its way")).toBeVisible({ timeout: 30_000 });
});

test("a refund of direct money is sent from the wallet, and can't be offered twice", async () => {
  const set = (settlementMode: string) => merchant.evaluate(async (mode) => (await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ settlementMode: mode }) })).status, settlementMode);
  expect(await set("direct")).toBe(200);
  try {
    await customerPays();
    await openNewestRefund();
    await expect(merchant.getByRole("heading", { name: "Send the refund" })).toBeVisible();
    await expect(merchant.getByText("If the route fails, it returns to")).toBeVisible();
    await merchant.getByRole("button", { name: "Send from wallet" }).click();
    await expect(merchant.getByText("Refund sent")).toBeVisible({ timeout: 30_000 });
  } finally {
    expect(await set("balance")).toBe(200);
  }
});

test("a reload while the wallet is asking doesn't offer the send again", async ({ browser }) => {
  const context = await browser.newContext();
  // The wallet never answers, as when someone reloads with the prompt still open.
  await context.addInitScript((address) => {
    (window as unknown as { ethereum: unknown }).ethereum = {
      request: ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return Promise.resolve([address]);
        if (method === "eth_chainId") return Promise.resolve("0x1");
        return new Promise(() => undefined);
      },
    };
  }, CUSTOMER_WALLET);
  const page = await context.newPage();
  await page.goto(linkUrl);
  await page.getByRole("radio", { name: "Ether on Ethereum" }).check({ force: true });
  await page.getByLabel(/Your Ethereum wallet/).fill(CUSTOMER_WALLET);
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /Pay from wallet/ }).click();
  await expect(page.getByRole("button", { name: "Check your wallet" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("You may have already sent this")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay from wallet/ })).toHaveCount(0);
  await page.getByRole("button", { name: "I checked, nothing was sent" }).click();
  await expect(page.getByRole("button", { name: /Pay from wallet/ })).toBeVisible();
  await context.close();
});

test("security headers are on, and the dashboard can't be framed", async ({ request }) => {
  const page = await request.get("/login");
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  // A widget nobody named a site for may go anywhere, which is what the embed test relies on.
  const embed = await request.get("/embed/wgt_probe");
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect(embed.headers()["x-frame-options"]).toBeUndefined();
});

test("the API is closed without a key, and a mutating request from another origin is refused", async ({ request }) => {
  expect((await request.get("/api/v1/payments")).status()).toBe(401);
  expect((await request.get("/api/state")).status()).toBe(401);
  expect((await request.post("/api/links", { headers: { origin: "https://evil.example" }, data: { title: "x" } })).status()).toBe(403);
});
