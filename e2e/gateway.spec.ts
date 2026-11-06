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
    const provider = {
      request: async ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "personal_sign") return (window as unknown as { __walletSign(m: unknown): Promise<string> }).__walletSign((params as unknown[])[0]);
        if (method === "eth_chainId") return "0x1";
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

test("checkout stays closed until a settlement wallet is connected", async () => {
  await merchant.goto("/dashboard/links/new");
  await merchant.getByLabel("Title").fill("Brand sprint deposit");
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

test("security headers are on, and the dashboard can't be framed", async ({ request }) => {
  const page = await request.get("/login");
  expect(page.headers()["x-frame-options"]).toBe("DENY");
  expect(page.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(page.headers()["x-content-type-options"]).toBe("nosniff");
  const embed = await request.get("/embed/wgt_probe");
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
});

test("the API is closed without a key, and a mutating request from another origin is refused", async ({ request }) => {
  expect((await request.get("/api/v1/payments")).status()).toBe(401);
  expect((await request.get("/api/state")).status()).toBe(401);
  expect((await request.post("/api/links", { headers: { origin: "https://evil.example" }, data: { title: "x" } })).status()).toBe(403);
});
