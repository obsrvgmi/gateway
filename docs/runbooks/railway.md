# Running on Railway

Measured on a test-mode deployment on 2026-11-07. A production deployment is the same without the test build, and needs everything in [going-live.md](./going-live.md) first.

## Services

One project holds Postgres, `web` and `worker`. Both app services build the repo's `Dockerfile`. Set their commands on the service itself, because a `railway.json` in the upload wasn't applied when we tried it.

| Service | Start command | Pre-deploy command | Health check |
| --- | --- | --- | --- |
| `worker` | `node dist/worker/index.mjs` | `node dist/server/db/migrate.mjs` | None |
| `web` | `node server.js` | None | `/api/health`, 180 second timeout |

**Deploy the worker first.** It runs the migration, and the web health check fails until the worker has written a heartbeat.

`railway up` uploads the folder it's given, uncommitted changes included. Deploy from a clean export of a pushed commit, so you know what's running:

```bash
git archive origin/main | tar -x -C /tmp/gateway-deploy
railway up /tmp/gateway-deploy --path-as-root --service worker --detach
railway up /tmp/gateway-deploy --path-as-root --service web --detach
```

## Variables

Set these on both `web` and `worker`:

```bash
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_URL=https://your-web-domain
SECRET_KEY=...                   # the same value on both: openssl rand -base64 48
PAYMENTS_MODE=sim
TRUST_PROXY=true
TRUSTED_PROXY_HOPS=2
NEXT_PUBLIC_TEST_BUILD=true      # test deployments only. Railway passes it to the build because the Dockerfile declares it
```

## Proxy hops are 2 here

Railway sends `X-Forwarded-For: <client>, <railway edge>` and drops whatever the client sent. With `TRUSTED_PROXY_HOPS=1` the app reads the edge's address instead of the visitor's, so unrelated people share one rate limit, and one person's limit moves around as the edge changes.

Check it after any change of host. Request a sign-in link, then look at the newest key:

```sql
select key from rate_limits where key like 'login:ip:%' order by window_start desc limit 3;
```

It must hold your own public address. To test forging, send 6 sign-in requests for one email, each with a different `X-Forwarded-For` header. The sixth must get a 429. Windows are fixed at 15 minutes, so a burst across a boundary won't trip it. Repeat it if the clock was near one.

## Signing in without an email provider

The `console` provider doesn't help here: in production it logs that the email wasn't delivered, and never prints the link. Use the `file` provider instead:

```bash
EMAIL_PROVIDER=file
EMAIL_FILE=/tmp/gateway-emails.jsonl
```

Then read the link from the container, after asking for it on the site:

```bash
railway ssh --service web "tail -1 /tmp/gateway-emails.jsonl"
```

Sign-in, invite and wallet emails are written by `web`. Notifications are written by `worker`, in its own copy. The file is lost on each deploy. Only people with access to the Railway project can sign in this way. To let anyone else in, set `EMAIL_PROVIDER=resend` with a key.
