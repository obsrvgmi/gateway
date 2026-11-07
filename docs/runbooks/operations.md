# Operations

## Processes

One image runs as two services, sharing `DATABASE_URL`, `SECRET_KEY` and `APP_URL`.

| Service | Command | Notes |
| --- | --- | --- |
| Web | `node server.js` | Health check: `/api/health` |
| Worker | `node dist/worker/index.mjs` | Polling, webhooks, email, schedules, sanctions list. Several can run. Jobs use `FOR UPDATE SKIP LOCKED`. |
| Migrate | `node dist/server/db/migrate.mjs` | Run before starting a new version. |

`/api/health` returns 503 with `worker_stalled` when the poller hasn't run for 2 minutes. **Alert on this.** Funds are safe, but statuses stop updating and customers wait.

## Off switches

Pausing stops new quotes. Payments in flight keep polling.

```bash
node dist/scripts/ops.mjs status
node dist/scripts/ops.mjs pause payments "Provider incident"
node dist/scripts/ops.mjs pause chain:bsc "Chain halted"
node dist/scripts/ops.mjs pause asset:ARB "Low liquidity"
node dist/scripts/ops.mjs resume chain:bsc
```

## Sanctions list

The worker adds the OFAC digital-currency addresses daily from a public mirror of the SDN list. It only ever adds, so a failed fetch can't empty the list. A failure logs `sanctions list refresh failed`. Screening still runs with what's there, so **alert on it**.

```bash
node dist/scripts/ops.mjs screen add 0xabc... "Reason"
node dist/scripts/ops.mjs screen remove 0xabc...
```

## Logs to alert on

| Message | Meaning | Do |
| --- | --- | --- |
| `quote guard failed` | A provider response failed a check. No address was shown. | One is odd. Several, pause the route and ask NEAR. |
| `payment settled below the quoted amount` | A merchant got less than promised. The payment is `underpaid`, the merchant was told, and it can't be refunded from the dashboard. | Contact NEAR with the `correlationId` on the payment. |
| `deposit changed after a final outcome` | A second deposit may have reached a used address. The merchant gets a notification. | Find the funds with NEAR. Records don't change automatically. |
| `status polling keeps failing` | The provider is failing for one address. Money in flight is never dropped, only retried less often. | Check NEAR's status and your API key. |
| `provider reported success with no amount` | NEAR said SUCCESS without saying what arrived, so the payment isn't marked settled. | Ask NEAR with the payment's `correlationId`. |
| `two refunds funded for one payment` | A refund the merchant had replaced got funded as well. The merchant was told. | The customer may be paid twice. Ask the merchant, and NEAR if needed. |
| `payout delivered below its minimum`, `refund delivered below its minimum` | It went, but less arrived than the signed quote's minimum. The merchant was told. | Contact NEAR with the deposit address. |
| `payments stuck in flight` | Money has been moving for over 6 hours. | Ask NEAR. Docs say a held transaction can be unavailable "for a period or indefinitely". |
| `balance read failed` | NEAR RPC is down. Dashboards show balances as unavailable, and payouts are refused. | Consider a paid RPC via `NEAR_RPC_URL`. |

## Merchant lost their settlement wallet

Gateway can't move their funds, and nobody can without the key. To let them receive new payments on a new wallet, after proving who they are out of band:

```sql
-- Confirm first: no payments in flight to the old wallet, and the owner has been emailed.
update organizations set wallet_address = null, wallet_verified_at = null where id = 'org_...';
insert into audit_log (org_id, actor_type, actor_id, action, detail) values ('org_...', 'system', 'ops', 'wallet.reset', '{"reason":"..."}');
```

They then connect a new wallet as if for the first time. **This is the one path around the wallet-signature rule, so a stolen email account must never be enough to trigger it.** The balance under the old wallet stays there. A refund of a payment that landed there can still be signed by that wallet.

## Rotating secrets

- `SECRET_KEY` encrypts webhook signing secrets and tags wallet challenges. Rotating it breaks every stored webhook secret, so merchants would need to re-create endpoints. Treat it as long-lived, and keep it in your platform's secret store.
- `ONECLICK_API_KEY` can rotate at any time with a restart.

## Limits to know

- Dashboard metrics are computed in the browser from the newest 10,000 payments. Past that the dashboard says so.
- The worker polls up to 25 of each kind every 2 seconds, about 750 addresses a minute per worker. Add workers if `next_poll_at` falls behind.
- Rate limits and sessions live in Postgres. `purge` clears old rows hourly.
