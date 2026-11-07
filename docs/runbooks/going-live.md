# Going live

The app runs in test mode until every step here is done. Nothing in this runbook happens by itself. Real money needs a person to set the acknowledgement phrase on purpose.

## 1. Before any real money

| Item | Who | Why |
| --- | --- | --- |
| NEAR partner key from [partners.near-intents.org](https://partners.near-intents.org/home) | Owner | Live mode refuses to start without one. Without a key, NEAR also adds 25 bps. |
| Written answers from NEAR, see below | Owner | Terms 4.1(a), 4.1(e), 4.1(f) and 4.1(h) bear directly on this product. |
| Lawyer's read of `/terms`, `/privacy` and the position that merchants carry KYC, AML and licences | Owner | These are drafts. The pages say so until you remove that line. |
| Production domain, hosting and email accounts | Owner | `APP_URL` must be the real https origin, or every mutating request is refused. |
| A CDN that reports the visitor's country, if you want geo-blocking | Owner | Set `GEO_COUNTRY_HEADER`. Without it, nothing is geo-blocked. |

### Questions for NEAR, in writing

1. **Gateway clause (4.1(a)).** Does a hosted checkout, embeddable widget and merchant REST API count as exposing the API "as a standalone API service, proxy, wrapper, or gateway"? The merchant API exposes payments and links, never quotes.
2. **Verifiable wallet (4.1(h)).** Each transaction must carry the originating user's visible wallet. Customers paying from non-EVM wallets type their address. Is that enough?
3. **End-user checks (4.1(f)).** "End-User" reads as covering paying customers. We screen wallets against sanctions lists, and merchants accept responsibility for KYC and AML. Is that sufficient, or do you expect more for payers?
4. **Retention (4.1(e)).** The terms cap caching at 24 hours, with a narrow history exception. The API docs tell partners to save quotes and signatures for disputes. We keep them with each payment. Please confirm.
5. **Bitcoin quote signatures.** Quotes touching Bitcoin don't verify with `verifyQuoteSignature` from your SDK 0.1.26, dry or live, in either direction, while every other route we tested does. Why? We keep Bitcoin closed until we know.
6. **Second deposits.** What happens to a second deposit to a used address, or one after the deadline? The docs don't say.
7. **Frozen balances.** Can a flagged account's balance in `intents.near` be frozen, for how long, and how does a merchant appeal?
8. **Minimums.** Are the $1,000 and $100 origin-to-origin minimums still in force, and do they apply when `recipientType` is `INTENTS`?

## 2. Configure

Set these on both the web and worker processes, then deploy with `PAYMENTS_MODE=sim` first.

**Build the production image with `NEXT_PUBLIC_TEST_BUILD` unset.** Its browser code then trusts only NEAR's signing key. Checkout works in test mode on that image, but a simulated payout or refund is refused by the browser, which is correct. To try those on a staging environment, build a separate image with `--build-arg NEXT_PUBLIC_TEST_BUILD=true`. Live mode refuses to run on a test build.

```bash
DATABASE_URL=...
APP_URL=https://your-domain
SECRET_KEY=$(openssl rand -base64 48)
TRUST_PROXY=true                 # required for live. Only behind a proxy that appends X-Forwarded-For
TRUSTED_PROXY_HOPS=1             # how many proxies do. Too low buckets everyone together. Too high trusts forged addresses. Railway is 2
EMAIL_PROVIDER=resend
RESEND_API_KEY=...
EMAIL_FROM="Gateway <no-reply@your-domain>"
```

Run the migration, start both processes, and check `/api/health` returns `{"status":"ok","mode":"sim"}`. A `worker_stalled` status means payments aren't being tracked, so don't continue.

Check the proxy hop count on the real host, because the right number depends on it. The steps are in [railway.md](./railway.md), and they work anywhere. If the rate limit keys don't hold your own address, stop and fix it.

Run the live contract test from a machine with network access. It uses the real API and sends no funds:

```bash
npm run test:live
```

Stop if it fails. The most important failure is the one named "still finds Bitcoin's signature broken": that means NEAR changed it, so reopen the route after checking why.

## 3. Switch on, closed

Live mode with every route paused, so nothing can be quoted yet:

```bash
node dist/scripts/ops.mjs pause payments "Before canary"
```

```bash
PAYMENTS_MODE=live
ONECLICK_API_KEY=...
LIVE_PAYMENTS_ACK="I understand this moves real customer funds"
APP_FEE_BPS=0
```

If any gate fails, payments stop rather than quietly becoming test mode: `/api/health` returns 503 with `live_refused` and the reasons. Confirm it shows `"mode":"live"`.

## 4. Canary, with your own small funds

Use a wallet you control as the merchant and a separate one as the customer. Use the smallest amounts the route allows. Open one route at a time.

```bash
node dist/scripts/ops.mjs resume payments
```

Do these in order. Stop at the first surprise.

| # | Do | Check | Answers |
| --- | --- | --- | --- |
| 1 | Connect a settlement wallet. Create a link for $5, paid in USDC on Base, received in USDC. | The link opens in another browser. | |
| 2 | Pay it from the customer's wallet with the one-click button. | Status moves on its own. The balance appears on Payouts. `balance` on chain matches. | Does the Intents route work end to end? |
| 3 | Pay out the balance to the settlement wallet. | The wallet signs a transfer. Funds arrive. The explorer link works. | The ERC-191 flow, with real funds. |
| 4 | Pay a new link, then refund it from the dashboard. | The customer's wallet receives it, in the asset they paid with. | Refund route and fees. |
| 5 | Pay with ETH on Ethereum, received in USDC. | The merchant gets exactly the link's amount. | Swap path and real fees. |
| 6 | Underpay on purpose, below the minimum shown. Let it return. | The customer gets it back less `refundFee`. The checkout says what happened. | Real `INCOMPLETE_DEPOSIT` handling. |
| 7 | Let a quote run out, then send to the old address. **Only with an amount you can lose.** | The late deposit is tracked, or returned. | Real behaviour past `payBy` and past `deadline`. |
| 8 | Switch to direct settlement. Pay. Refund it. | Funds reach the wallet with no balance step. The refund routes to the customer's chain. | Direct mode. |
| 9 | Send $150 from Tron, and a small amount from BNB Chain. | Whether each fills. | **Do minimums apply to Intents recipients?** Set `MINIMUMS_EXEMPT_INTENTS_RECIPIENT=true` only if both fill. |

Record each transaction hash and any fee that surprised you. Update the fee copy if the real fees differ.

## 5. Open to merchants

Only after the canary passes and the owner approves it explicitly:

- Remove the draft lines from `/terms` and `/privacy` once a lawyer has signed off.
- Set `APP_FEE_BPS` and `APP_FEE_RECIPIENT` if charging. With a key, app fees split 50/50 with 1Click, and 1Click's half has a 20 bps minimum (1 bp on stablecoin pairs), so a fee under 40 bps keeps less than half.
- Watch the first real payments, and the logs for `quote guard failed`, `status polling keeps failing`, `payments stuck in flight` and `payment settled below the quoted amount`.

## Going back

- **Stop new payments now:** `node dist/scripts/ops.mjs pause payments "reason"`. Payments in flight keep being tracked to the end.
- **Back to test mode:** set `PAYMENTS_MODE=sim` and restart both processes. Prefer pausing instead. Real payments in flight wait untracked until live mode returns, and nothing is lost, but customers see no updates meanwhile.
- **Deploy rollback:** redeploy the previous image. Migrations are additive, so an older version runs on a newer schema.
