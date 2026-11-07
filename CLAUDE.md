# CLAUDE.md

@AGENTS.md

`AGENTS.md` holds the BoardUI design rules (semantic tokens, composite type utilities, `cx()`, component-first) and the Next.js warning: this Next version differs from your training data, so read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. Parts of it are auto-generated (the Next.js block is rewritten by `next dev`; the BoardUI block is managed by the BoardUI CLI). Do not hand-edit those blocks.

## Scope

A `CLAUDE.md` in a parent directory of your checkout may describe a different product. Its product, architecture and design instructions do not apply here. This file wins for this repo.

## Keep this file current

Any change to routes, the data model, `lib/`, shared components, conventions, or the "What's illustrative" table below must update this file in the same change.

Automation: `.claude/settings.json` registers a Stop hook, `.claude/hooks/claude-md-sync.sh`. It blocks once when uncommitted files in `app`, `lib`, `components/dashboard`, `components/checkout`, `components/marketing`, `components/brand` or `styles` are newer than this file, then lets the agent stop if nothing needs documenting. It only runs in Claude Code sessions; people on other tools must follow the rule by hand.

## What this is

"Gateway" (working name): a non-custodial crypto payment gateway. Two products: Payment Links (hosted checkout at `/pay/[id]`) and an embeddable Payment Collection Widget. The customer pays with any supported asset; the merchant receives their chosen asset, routed by NEAR Intents' 1Click API. Gateway never holds funds or keys.

**It runs in test mode unless every live gate passes** (`paymentsMode()` in `server/env.ts`). Test mode uses `SimProvider` for the same pipeline, with no network and no funds. Going live: `docs/runbooks/going-live.md`. Design and known limits: `docs/superpowers/specs/2026-11-06-production-gateway-design.md`.

Stack: Next.js 16.4 App Router, React 19.3, Tailwind CSS v4, TypeScript, Postgres, Drizzle, `viem`, `zod`, BoardUI, React Aria, Recharts, Inter via `next/font`, `qrcode.react`, `@web3icons/react` (exact pin; token and network logos).

## Commands

```bash
npm run dev:db       # local Postgres on :5433, no Docker. Set DATABASE_URL as printed
npm run dev          # dev server
npm run worker       # background jobs. Needed for anything to settle
npm run build        # production build, then worker, migration and ops bundles in dist/
npm run lint         # eslint
npm run typecheck    # generates route types, then tsc (plain tsc fails on a fresh clone)
npm test             # vitest, on real Postgres via embedded-postgres
npm run test:e2e     # Playwright on the production build. Build first, with NEXT_PUBLIC_TEST_BUILD=true. Ports 3910-3912, 55432
npm run test:live    # real guards against the real 1Click API and NEAR RPC. Sends no funds
npm run test:mutation # deletes each guard in scripts/mutate-guards.mjs. Edits files as it runs: use a clean tree or a worktree
npm run db:generate  # after changing server/db/schema.ts
npx boardui@latest add <name> --yes   # add a BoardUI component into components/
```

## Repo map

| Path | Owner |
| --- | --- |
| `app/` | ours: routes (thin; pages render a view component) |
| `lib/` | ours, shared by browser and server: `assets.ts` (catalog with provider ids), `money.ts` (BigInt maths), `intents.ts` (quote signature, what a wallet may sign), `address.ts`, `types.ts`, `metrics.ts`, `payouts.ts` (display ledger), `attention.ts` (Overview's "Needs you"), formatting. Browser only: `store.ts`, `api.ts`, `wallet.ts`, `sign-intent.ts`, `send-guard.ts`. Server only: `seed.ts` (test-mode sample data) |
| `server/` | ours, server only: `env.ts`, `db/` (schema, migrations), `auth/`, `http/` (route wrappers, rate limit, API keys), `schemas.ts`, `resources.ts`, `state.ts`, `jobs.ts`, `outbox.ts`, `notify.ts`, `audit.ts`, `crypto.ts`, `webhooks/`, `email/`, `sample.ts`, and `payments/` (see Architecture) |
| `worker/` | ours: the background process |
| `scripts/` | ours: `ops.ts` (off switches), `mutate-guards.mjs`, `dev-db.ts`, `copy-standalone.mjs` |
| `packages/react/` | ours: `@gateway/react`, not published yet |
| `test/`, `e2e/` | ours: `test/live/` talks to the real API and is excluded from `npm test` |
| `components/checkout/` | ours: `LiveCheckout` (the real one), `CheckoutWidget` (fake timeline, previews and landing only), `HostedCheckout` |
| `components/auth/` | ours: sign-in, onboarding, invitation forms |
| `components/marketing/` | ours: landing `Hero`, `SiteNav` (scroll-aware header and mobile sheet), `Products` (`LinkScene`, the note), `WidgetScene`, `Scene` (the shared template, `ReceivePicker`, `useCopy`), `ShopWindow` (the merchant page), `SiteFooter`, `FlowChannels` (SVG grooves, exports `Channel`), `Bus` (the channel down the page's axis) |
| `components/lazy-toaster.tsx` | ours: loads the toast stack on the first toast |
| `components/dashboard/` | ours: shell, sidebar, `top-bar.tsx`, `command-palette.tsx`, `preload.ts` (lazy overlay loaders, idle preload), `unsaved.tsx` (`useUnsavedGuard`, `guardedPush`), `volume-chart.tsx` (the only Recharts consumer), `ui.tsx` primitives (`Bento`, `Panel`, `Stat`, `PanelLink`, `DeltaChip`, `SimulatedTag`, `ModeTag`, `useWideMain`, `useMainAtLeast`, `MAIN_WIDE`, `MAIN_ULTRA`, `CARD_SPANS`), `charts.tsx`, `position-strip.tsx`, `payment-drawer.tsx`, `payout-dialog.tsx`, `refund-dialog.tsx`, `settlement-card.tsx`, `notification-bell.tsx`, `shortcuts.tsx`, `csv.ts`, `fmt.ts`, `skeletons.tsx`, `asset-select.tsx`, `views/*` |
| `components/brand/` | ours: `Logo`, `LogoMark`, `TokenMark`, `Rosette` (guilloche seal) |
| `components/nav-button.tsx` | ours |
| `styles/` | `theme.css`, `typography.css`, `globals.css` are BoardUI, with our button depth recipe at the end of `theme.css`; `theme-scope-light.css` is generated (see gotchas); `stage.css` is the hero and the plate material `/pay` shares; `landing.css` is everything else on `/`, imported by `app/page.tsx` only |
| `public/guilloche/` | ours: static SVG art used as CSS masks (`rosette`, `rosette-ring`, `rosette-hero`, `wordmark`). Generated once with a throwaway script: the rosettes from the formula in `components/brand/rosette.tsx`, the wordmark from Inter Bold outlines. Masks, not inline SVG, so they add no HTML weight |
| `components/base/`, `components/application/`, `components/foundations/`, `utils/`, `hooks/` | vendored BoardUI source. Prefer adding via the CLI over editing; do not reformat. |

`.cursor/rules/boardui.mdc` (Cursor copy of the BoardUI rules) and `.agents/skills/` (design skills for agents) are tooling, not app code.

Routes:

| Route | File | Notes |
| --- | --- | --- |
| `/login`, `/login/verify` | `app/login/` | Magic link sign-in. Verify posts from the browser, so mail scanners can't burn the token |
| `/onboarding` | `app/onboarding/page.tsx` | Workspace and Merchant Terms acceptance |
| `/invite/[token]` | `app/invite/[token]/page.tsx` | Joining a team. Works only for the invited address |
| `/embed/[id]` | `app/embed/[id]/page.tsx` | What `public/widget.js` frames. The only page that may be framed |
| `/docs`, `/terms`, `/privacy`, `/status` | `app/...` | Developer docs, legal drafts, health |
| `/` | `app/page.tsx` | Landing: `SiteNav`, `Hero` (`FlowChannels` + live `CheckoutWidget`), `Products` (`#links` and `#widgets`, one template each), `SiteFooter` |
| `/pay/[id]` | `app/pay/[id]/page.tsx` | Hosted checkout: `LiveCheckout`, reading the public API |
| `/dashboard/links/[id]`, `/dashboard/widgets/[id]` | `.../page.tsx` | One source: performance, share or embed, its payments |
| `/dashboard/statements` | `.../statements/page.tsx` | Monthly records and CSV |
| `/dashboard/notifications` | `.../notifications/page.tsx` | Everything the bell shows |
| `/dashboard` | `app/dashboard/page.tsx` | Overview: position strip, volume chart or table (metric, compare, bars open that period), "Needs you", live feed, KPIs, route flow, breakdowns, setup checklist. Figures link into filtered Payments |
| `/dashboard/links` | `.../links/page.tsx` | Link cards or table, search, status filter, pause, delete |
| `/dashboard/links/new` | `.../links/new/page.tsx` | Create link in two steps, live preview, share URL + QR |
| `/dashboard/links/[id]/edit` | `.../links/[id]/edit/page.tsx` | Same form as `new`, reopening a saved link |
| `/dashboard/widgets` | `.../widgets/page.tsx` | Widget cards with thumbnail, search, status filter, pause, delete with undo |
| `/dashboard/widgets/new` | `.../widgets/new/page.tsx` | Customize widget (identity, logo, amount, suggested amounts, accepted assets, look, email, after-payment), preview on a light or dark page at two widths, embed snippet |
| `/dashboard/widgets/[id]/edit` | `.../widgets/[id]/edit/page.tsx` | Same builder as `new`, reopening a saved widget |
| `/dashboard/payments` | `.../payments/page.tsx` | Summary strip, filters and chips, sortable table (list on narrow screens), bulk actions, status and asset rail, drawer with timeline. Filters seed from `?q= status= asset= type= source= chain= range=` and `from= to= label=` (ms, for one chart bar) |
| `/dashboard/payouts` | `.../payouts/page.tsx` | Balance, next payout, schedule, refund window, hold releases, destinations, runs, history, pay-out dialog, retry, CSV |
| `/dashboard/settings` | `.../settings/page.tsx` | Tabs (`?tab=`): settlement wallet, business and branding, developers, team and alerts, workspace (theme, sample data in test mode, audit log). At `@ultra` the tabs go and every section shows at once. Payout rules live on `/dashboard/payouts` |

Each page renders a `components/dashboard/views/*` component; `app/dashboard/layout.tsx` wraps them in `DashboardShell` and imports `app/dashboard/dashboard.css` (chart hues, `--viz-primary`, a darker focus ring, the surface restatement, rail, top bar and strip styles, skeleton and feed motion). `app/dashboard/error.tsx` is the error boundary.

## Architecture

- **Client state**: `lib/store.ts`. A module-level `state` read through `useSyncExternalStore` (`useGateway()`), loaded from `GET /api/state`, then merged from `/api/state/changes` every 8 seconds. `actions.*` update optimistically and put the old value back with a toast if the server refuses. **Money never goes through these.** Payouts and refunds call the API and wait. `useGatewayReady()` is false until the first load, and `DashboardShell` mounts views only then, so any view may seed `useState` from the store. A 401 sends you to `/login`, and a workspace-less account to `/onboarding`.
- **API routes**: every handler is wrapped in `server/http/route.ts`. `orgRoute(permission, ...)` checks session, Origin and role, and hands over `orgId`. **Every query must be scoped to `orgId`.** `apiRoute` is the same for API keys. `publicRoute` is for checkout: no session, so `limitCheckout` and returning only `publicSource`/`publicSession` fields. RBAC is `server/auth/rbac.ts`. Input is parsed with `server/schemas.ts`.
- **Payments engine** (`server/payments/`). All money maths is BigInt on smallest units (`lib/money.ts`). A float may only appear on the way to a screen.
  - `provider/`: `OneClickProvider` and `SimProvider` behind `SwapProvider`. Responses are parsed with zod, so an unknown status fails rather than being misread. `ProviderRejected` is a definite no. `ProviderUnavailable` means the outcome is unknown, and nothing may be concluded from it.
  - `guards.ts`: echo, signature, usability, route minimums, off switches, unverifiable routes, screening, price freshness, refund fee, customer countdown.
  - `state-machine.ts`: pure. Forward only. `PENDING_DEPOSIT` never means unpaid. `expired` isn't final. A merchant refund owns the state once started. Polling never stops for money in flight, however long the provider fails. SUCCESS with less than quoted is `underpaid`, not settled, and with no amount it isn't anything yet.
  - `checkout.ts`: the row is inserted **before** the provider is called, keyed by the customer's idempotency key.
  - `poller.ts`, plus `pollDuePayouts` and `pollDueRefunds`: claim rows by pushing `next_poll_at` out with `FOR UPDATE SKIP LOCKED`, then apply a status under a row lock. A transition writes `payment_events` and `outbox` in one transaction.
  - `intent-flow.ts`, `payouts.ts`, `refunds.ts`: a move out of a balance is a quote with `depositType: INTENTS`, then `generate-intent`, a wallet signature, then `submit-intent`. Send is compare-and-set, stamped first, and a late response can't move a row back. An unknown outcome stays `submitting` and resends the same signed intent, which is safe because its nonce is single-use. **A refused resend proves nothing**, because a duplicate of a send that landed is refused too. Past the signed deadline plus `RELEASE_GRACE_MS`, judged by when the status was read and never by when a slow resend finished, it counts as failed. FAILED isn't REFUNDED, so any failure stays reserved and watched for a day from `failedAt`, and `Payout.watching` hides the retry. SUCCESS with no amount isn't done. In test mode a route refund is finished with `/api/refunds/[id]/sim`, because a `sim_` address is deliberately not one a wallet can send to. A route refund's address can't be cancelled, so if a replaced one is funded its unfunded replacement closes, and if both were funded `alert.refund_twice` goes out. Rows from one mode can't be refunded or signed in the other. In the browser `sendGuard` records a send before the wallet answers, and after a signature only a 4xx means "not sent" (`isRefusal`): anything else may have gone.
  - `availability.ts`: balance from chain, less holds and in-flight. `wallet.ts`: changing the settlement wallet needs both wallets' signatures and an empty balance.
- **What a wallet may sign**: `personal_sign` signs any text, and an Intents account accepts a signed `add_public_key` the same way, so one wrong signature gives away a balance for good. **Never pass text to `signMessage` directly: use `signTransfer` or `signChallenge` in `lib/sign-intent.ts`.** `checkTransferPayload` runs on the server and again in the browser. The wallet only sees a routing address, so the browser verifies 1Click's signature, that it's a live quote (a dry quote's signature covers no address), and that everything matches what the merchant chose. Expected values come from the merchant's own choices and `ASSETS`, never the response being checked. A production bundle only trusts `ONE_CLICK_QUOTE_KEY`. `NEXT_PUBLIC_TEST_BUILD=true` lets a test build trust the simulator's key, and it's fixed at build time so a server response can't switch it on.
- **Outbox and worker**: `emit()` in the same transaction as the change. `processOutbox` fans out to webhook deliveries, notifications and email. `alert.*` events never reach merchants' servers. `deliverDueWebhooks` signs with HMAC, retries on a schedule, and checks private addresses inside the socket's DNS lookup, so rebinding can't get past it.
- **Metrics**: `lib/metrics.ts` derives everything from the payments array in the browser, capped at the newest 10,000. `rangeReport(payments, range)` returns buckets that partition the window, so they add up to the headline. The last bucket is flagged `partial` and its comparison stops at the same moment in the earlier period, so a running day or month is never measured against a whole one. Success rate leaves in-flight payments out of the denominator.
- **Money model** (`lib/payouts.ts`): Gateway never holds funds, so there is no Gateway balance. Payments settle into the merchant's own settlement account and a payout sweeps it to a destination. `ledger()` derives arriving, on hold (settled within `holdDays`, the merchant's own refund window, not a Gateway reserve) and paid out from records, and takes available from `settlement.available`, which starts from the chain. Do not write copy that implies custody: say "settlement account" and "refund window", not "wallet balance with us" or "reserve". Say non-custodial, never decentralized. `settings.walletAddress` is the default destination's address, and `settlement.wallet` is the signing wallet.
- **Dashboard surfaces**: `dashboard.css` restates BoardUI's surface, border and text tokens rather than adding parallel ones, so vendored components follow. Those tokens and the `--viz-*` hues sit on `html:has(.dash-root)`, not `.dash-root`, because modals, drawers and popovers portal to `<body>`. `.dash-plate` is a panel, `.dash-well` a recess, `stage-plate` is reserved for the position strip and balance. Texture means "not final yet" everywhere: the chart's running bar and the balance bar's arriving segment.
- **Dashboard controls**: the "Control system" block in `dashboard.css` is one material for every control, the landing page's: a milled well with raised keys. Mostly token restatements (segmented control, status tints, menu hover, disabled); where a token can't carry it, it targets BoardUI's own classes, which works because the file is unlayered. Fields have a `bui-field` hook in `input.tsx` and `textarea.tsx`, and write `--tw-inset-shadow` so the vendored rings still stack. Chips are matched by `[class*="bg-status-"].px-1\\.5`, because other small elements such as `SimulatedTag`'s dot share those colours. A light preview inside a dark page takes its text tokens back with `.theme-scope-light`, since the dashboard's tokens sit on `<html>`. Type: `.dash-title`, `.dash-panel-title`, `.dash-figure`. Options that read as a set use `.dash-coin`. New controls should reuse these rather than add a style.
- **Dashboard surfaces**: `dashboard.css` restates BoardUI's surface, border and text tokens rather than adding parallel ones, so vendored components follow. Those tokens and the `--viz-*` hues sit on `html:has(.dash-root)`, not `.dash-root`, because modals, drawers and popovers portal to `<body>`. `.dash-plate` is a panel, `.dash-well` a recess, `stage-plate` is reserved for the position strip and balance. Texture means "not final yet" everywhere: the chart's running bar and the balance bar's arriving segment.
- **Large screens**: the content caps at `--dash-max` (180rem, on `.dash-root`), so only a 3440 ultrawide sees a margin, and `.dash-bar`'s gutters follow it, so the breadcrumb and the page always share a left edge. Below that the room is spent, not stretched. Two width tiers on `<main>`'s content box, defined in `styles/globals.css`: `@wide` (100rem, a 1920 display) and `@ultra` (135rem, a 2560 display). `MAIN_WIDE` and `MAIN_ULTRA` in `ui.tsx` are the same numbers, for choices CSS can't make (`useMainAtLeast`). Nothing changes under `@wide`, so 1280 and below keep their layouts.
  - Monitor pages recompose on the 12-column `Bento` with `@wide:` and `@ultra:` spans, explicit rows and `order`. Overview at `@ultra` is one screen: chart, KPIs over settlement, needs-you and feed, then two rows of breakdowns. A group that is a row of tiles at `@5xl` and a block at `@ultra` is a `contents` wrapper that turns into a grid, so its tiles stay direct `Bento` children below that (`Overview` KPIs, `Payments` stats).
  - Tables gain columns rather than gaps: Payments adds Chain and Payer at `@wide`, ID and Settled in at `@ultra`, and 16 then 20 rows a page. Payouts adds Fee and Reference. Stats and the side panels move beside the table.
  - Card grids use `CARD_SPANS`: 2, 3, 4, then 6 across. `AddTile` fills the last row at each.
  - Builders stop at a readable form width: the form is a 46rem column and the preview takes the rest as a full-height artboard (`.dash-canvas`, sticky). The widget builder's panels go two across at `@ultra` and Settings' three (`.dash-masonry`).
  - Skeletons mirror all of this.
- **Quotes**: `lib/assets.ts`. `ASSETS` (mock USD prices, display decimals, chip tone), `PAY_ASSETS`, `RECEIVE_ASSETS`, and `quote(usd, pay, receive)` which adds a flat `ROUTE_FEE` (0.3%) only when the assets differ.
- **Catalog**: `lib/assets.ts`. `ASSETS` holds the provider's `assetId`, `blockchain` and `tokenDecimals`. `test:live` checks these against the provider. `usd` and `quote()` are illustrative, for the landing page and builder previews only.
- **`LiveCheckout`** (`components/checkout/live-checkout.tsx`): the real payment: choose, wallet, deposit, progress, receipt. It remembers the session in `localStorage`, so a reload shows the same address and never a second one. Pay-from-wallet is one shot. An expired quote warns before starting again, because money may already be on the way.
- **`CheckoutWidget`** (`components/checkout/checkout-widget.tsx`): a fake three-step timeline with illustrative prices, used by the landing hero, `ShopWindow`, the link preview and the widget preview. **Never use it to take a payment.**
- **Widget**: `public/widget.js` and `packages/react` frame `/embed/[id]` and listen for `postMessage`, checking origin and source. Only the id goes in the snippet (`lib/embed.ts`), so a page can't override what's accepted or charged.
- **Loop**: create a link -> share `/pay/<id>` -> customer pays a one-time address -> worker polls -> settled -> webhook, notification, email. Then the payment sits on hold for `holdDays`, becomes available, and `PayoutDialog` -> quote -> merchant's wallet signs -> worker polls.
- **Landing stage**: `Hero` owns pay asset, receive asset and checkout step, and passes them to `CheckoutWidget` (`showAssetPicker={false}`, `onStepChange`) and `FlowChannels`.
  - Layout: `styles/stage.css` (ours; `/pay` reuses it) defines the system at its top. Pay plate, card and receive plate share one row and height, side plates are equal, and the card sits on the page's centre axis. `@media (max-height: 820px)` keeps the hero above the fold on short laptops. Below 1100px the same machine rotates to vertical and the CTAs move above it.
  - Geometry: `FlowChannels` measures the centres of `[data-flow-pin=SYMBOL]`, `[data-flow-dock=SYMBOL]`, `[data-flow-out]` and `[data-flow-sink]` and routes each channel between them like a PCB trace: straight, one 45 degree jog with `BEND_RADIUS` corners, straight. All lanes share one jog centre, so they stay ordered and cannot cross. Do not put transforms on these elements or their ancestors, even in the load animation: that is why `stage-object` is opacity only. `--flow-axis` in `stage.css` keeps ports level with the centre of the rail's rows; if the rail's caption block changes height, change it too. `SOURCES` in `hero.tsx` is ordered by hue.
  - Render: an SVG under the plates, so a channel is lost beneath its socket ring with no seam while its path still ends at the node centre. Each channel is stacked strokes of constant width (lip, wall, floor) plus a lit layer and a four-dash comet. The chosen channel is lit; the rest are near-neutral. Motion is CSS only, driven by `data-state` and `pathLength={1}`, so no JavaScript runs per frame. `stroke-dashoffset` needs `px` units inside `calc()`, or the animation silently does nothing. The guilloche belongs to the plates and ground; keep channels plain. There is no WebGL or canvas on the landing page, so no fallback path exists.
  - Plates: `.stage-plate` and `.stage-card` are the page's one material: solid fill, machined bezel via a `border-box` gradient, a printed hairline (`::before`) and an engraved pattern (`::after`, applied as a mask so `--plate-engrave` themes it). `/pay` and the product stage use the same classes. `.stage-rule` is the double hairline divider.
  - Behaviour: the pause button (rendered twice; CSS shows one per breakpoint) stops the pulses. `prefers-reduced-motion` removes pulses and the fill animation; lit states still show. Until the visitor interacts, `Hero` steps through assets every 3.2s.
- **`CheckoutWidget` states**: idle, running and settled share one grid cell and the idle layer stays mounted (`invisible`, `inert`), so the card never changes size. Keep new states inside that height; the hero's ports depend on it.
- **Page structure**: `/` is one object. `styles/landing.css` documents it at its top. A channel (`Bus`) leaves the hero's seam, runs down the centre axis under the plates (`.bus-spine`, 1100px and up; short `.bus-stub`s below that) and ends at the seal in the footer. Text sits either side of the axis, as the hero's headline does, so keep the axis clear of text at 1100px and up. The spine's lit layer fills from `scroll(root)`.
- **`Products`**: two sections, one `Scene` template (`scene.tsx`), so they read as a pair and hold one height (`grid-template-rows` on `.product` fixes the first row at 42rem from 1100px up, so the two plates match at any one width). The goal is that anyone understands how it works and what they get, so each is: head, then "How it works" (three plain steps with their real controls inside) beside the live product, then "What you get" (four simple features). The columns split on the page's axis, so the plate's ports land on the seam, and `#widgets` mirrors `#links`. Copy stays free of jargon. Earlier versions were rejected as confusing: a settings sidebar, a code editor with site tabs, and one merged section. Keep controls inside steps, and keep the two sections parallel.
  - Controls live in `scene.tsx`: `Segmented` (a milled track with one thumb that slides on a transform, so its keys are equal widths), `ReceivePicker` and `CoinFace` (coin tiles: off is pressed into the plate, on is raised with a check badge; only the multiple choice group dims its off state). `.tray` is one milled bar with its action seated in it. `.product` fixes its first row at 42rem at 1100px and up, which is what keeps the two plates equal; content taller than that would break it.
  - `#links`: `PaymentNote`, a payment link drawn as a cheque, in the same ink in both themes (`.dark` on the element scopes its tokens), as the attachment in a chat (`.chat`). Amount, purpose and receive asset drive the note and chat only: the note stays SPECIMEN, and nothing here is a working link. Every size is in `cqi`, so it scales as one printed object; below a 28rem container it stacks as a portrait note. Two rosettes counter-rotate on a view timeline, which is what makes the moire run. The foil thread uses `--spectrum`, the rail's hues, and shifts with the pointer. Pointer values are written to `--mx`/`--my` directly, never React state. The SPECIMEN stamp is the page's honesty: keep it legible. The mock shows and the QR encodes the reserved domain in `DISPLAY_LINK`. The tray offers "Make your own" rather than Copy: a sample anyone could send must not look like a way to get paid.
  - `#widgets`: `ShopWindow`, a real `CheckoutWidget` on a stranger's page, driven by step 1 (colour, corners, theme, accepted coins). `.msite` follows neither the page's theme nor the green ground and its literal colours are the merchant's. The lamp is inline SVG. The tray shows the real snippet on one line. It only carries an id, because a widget's settings live in the dashboard. It sets `buttonLabel`, so the page keeps one button named "Pay ...". The widget's theme is the merchant's, so `.msite-widget` restates secondary text for each.
- **`SiteNav`**: fixed. Flush with the hero's gutters at the top of the page; past the top it docks into one machined bar, driven by CSS on `data-docked`. The component only reports what CSS can't see: left the top (a sentinel) and the current section (an observer on a mid-viewport band). The pill follows pointer and focus and rests on the current section. The bar's bottom edge is reading progress on `scroll(root)`. Below 1100px the links move into a React Aria `Modal` sheet.
- **`SiteFooter`**: the reverse of the note, ink in both themes (`.dark` plus its own tint for secondary text and button faces). The wordmark is `public/guilloche/wordmark.svg` as a mask over two counter-rotating rosettes, so the moire is live inside the letters. Links must stay real routes; do not add Docs, Blog or social links until they exist.
- **Buttons**: the depth recipe is `button-depth` (primary, danger) and `button-key` (secondary) at the end of `styles/theme.css`. Bezel, catchlight, lip, contact shadow and cast, plus a rise on hover and a seat on press. It writes `--tw-shadow`, not `box-shadow`, so `ring-*` focus rings stack on top. It is declared on the element, so `color-mix` sees a local accent. `--depth-edge` sets the hue of the bezel and cast.
- **Scroll choreography**: CSS scroll timelines at the end of `landing.css`, transforms and opacity only. Reveals sit under `@supports (animation-timeline: view())`, so without support content is simply there and the rosettes turn on a slow clock. `prefers-reduced-motion` removes all of it except the header's progress line, which only tracks position.
- **Other lib**: `format.ts` (USD/token/date formatting, `shortAddress`), `use-origin.ts` (SSR-safe `window.location.origin`), `site.ts` (name, tagline, marketing figures).

## Performance rules

- Measure on `next build` + `next start`, never dev.
- **HTML**: no generated art inline. The hero rosette was 177 KB of path data in the HTML of `/` and `/pay`; it is now `public/guilloche/rosette-hero.svg`, a mask on `.stage-art i`, preloaded with `preload()` from `react-dom` because its element can be the LCP candidate. Regenerating it needs the parameters in the old `Rosette` call: petals 60, rings 18, inner 6, outer 49, stroke 0.4 on a 1000 box, eight samples per petal. Chromium reports this mask as the LCP element on `/` at about 2.9s on a throttled phone profile, after hydration, even though the file has loaded by 1s and the headline paints by 1.3s; that entry did not move when the file got lighter.
- **Lazy, with held boxes**: `VolumeChart` (Recharts), `PayoutDialog`, `PaymentDrawer`, `CommandPalette`, the mobile nav `Drawer`, `DatePicker`, `DateRangePicker`, the QR on the created-link page, and the toast stack. `preloadDashboardExtras` fetches the first five on idle from `DashboardShell`, so the first open is instant. An overlay is mounted only once it has been opened (an `armed` flag), and then stays mounted for its exit animation.
- **Toasts**: `components/base/toast/toast.tsx` is the store and API and has no runtime imports, so calling `toast()` costs nothing. `toaster.tsx` is the stack and pulls in Motion. Never import `Toaster` into a layout; `LazyToaster` is the mount. Motion is only used by toasts and the date pickers: keep it that way.
- **Landing motion**: the 32 hero pulses animate `stroke-dashoffset`, which repaints on the main thread, so `Hero` pauses them with an `IntersectionObserver` once scrolled past. `content-visibility: auto` on `.note-art`, `.foot-art`, `.foot-word` and `.bus` drops their layers offscreen, so nothing there needs `will-change`. Each rosette pair turns one layer over a still one.
- **`overflow: clip`, never `hidden`, on the note and the art boxes.** `hidden` makes a scroll container, `view()` resolves to it, and the rosette silently stops turning.
- `@source not` in `styles/globals.css` keeps vendored extras no route renders out of the CSS. If one of them gets used, remove its line.

## Overlays and feedback

- Toasts: every consequential action confirms. Pass an `id` where a repeat would stack (copy, export, settings toggles). Cheap reversals get an `Undo` action; confirm with `AlertDialog` only what can't be undone (revoke a key, clear sample data). `ModeTag` marks test mode wherever money appears. The stack sits at the top on phones so it can't cover stacked modal footers.
- Modals and drawers: `.modal-surface` and `.modal-backdrop` in `dashboard.css` restyle the vendored overlays. The panel is white in light mode because `--color-background-full` is the mint page ground here.
- A payout's outcome: `PayoutDialog` follows the store, so it shows what the provider reported. Closing it changes nothing, and a notification follows.
- `useUnsavedGuard(dirty)` covers links, menus (`guardedPush`), the palette, reload and tab close. Any new `router.push` reachable while a form is dirty must use `guardedPush`. The browser's Back button isn't covered: the App Router can't block history navigation.
- `app/dashboard/template.tsx` plays the opacity-only route settle (`.dash-route`) and holds the page's flex column; views still return fragments.
- `PageSkeleton` is chosen by route. If a route's layout changes, change its skeleton too.
- Overview on phones: below 768px of `main`, the seven breakdowns and the setup steps wait behind a control. They unmount rather than hide, because of the `TokenMark` rule below.

## Gotchas

- `DropdownDivider` used to bleed `-mx-2.5` past a panel assumed to be `p-2.5`. Consumers override that to `p-2`, so it overflowed by 2px, and `MENU_POPOVER_SURFACE`'s `overflow-y-auto` turned that into a horizontal scrollbar on every menu with a divider. It is inset now. Don't put negative-margin bleeds inside a scrolling surface.
- `100vw` includes a classic scrollbar, and `fixed` positions against the box without it, so `calc(100vw - 24px)` anchored to `end` runs off the start edge. Use `100%` on fixed elements. Headless Chromium hides scrollbars by default and won't show this.
- `.dash-rail`, like the rest of `dashboard.css`, beats utilities, so `w-full` on it did nothing and the phone drawer showed a 15rem rail in a 20rem panel. Vary it with `--rail-width`.
- `TabList`'s underline is a sibling of the tabs, so a scrolling tab strip leaves it behind and it can widen the page. Make tabs fit (Settings shortens "Team and alerts" on phones); don't add `overflow-x-auto`.
- Container queries see `<main>`'s content box, while `clientWidth` includes the padding. `useMainAtLeast` subtracts it, so its numbers match `@wide` and `@ultra`.
- `.dash-masonry` works by `columns`, so inside it `col-span-*` does nothing and order runs down, not across.
- Vendored `Select`, `Input` and `Textarea` pass a string `label` on as `aria-label` as well. Next keeps visited routes in a hidden `Activity`; layout effects don't run there, so React Aria's label slot stays empty and it warns in dev about a field that does have a label.
- `DateRangePicker` shows one month and no presets at 860px and below, because the two-month popover is 814px wide. The choice is made once, when it mounts.
- `app/error.tsx` exists because `app/dashboard/error.tsx` can't catch its own layout, and the rail reads the store there.
- The provider refuses burn addresses and token contracts as `refundTo`, with `refundTo is not valid` or `Internal server error`. Preview placeholders in `checkout.ts` are plain accounts for that reason.
- 1Click ignores the deadline you ask for and returns one days later. Use the returned one, and our own countdown (`customerPayBy`).
- A quote returning a deposit address proves nothing about whether it fills. NEAR's minimums live in its changelog: re-check `ROUTE_MINIMUMS_USD` before each release.
- The worker and `scripts/` run outside Next, so `server-only` resolves through `--conditions=react-server` (`npm run worker`) or bundling (`build:worker`). Files imported by them mustn't use `next/*`.
- Every state-changing cookie route needs `Origin`, so `curl` against the session API gets a 403. API-key routes don't use cookies and don't check it.
- Zod 4 keeps `.default()` through `.partial()`. A patch schema built on one with defaults writes them for every field left out, so `linkPatch` and `widgetPatch` come from shapes with no defaults.
- `proxy.ts` reads the database, for `/embed/*` only, to set `frame-ancestors` from the widget's `site`. Everything else there is an optimistic redirect.
- `vitest.live.config.mts` is standalone on purpose. `mergeConfig` concatenates `exclude`, which silently skipped the live tests.
- Safari has no `requestIdleCallback`; `preloadDashboardExtras` falls back to a timer.

- **Brand accent is `#00EC97`** (`--color-accent-500` in `styles/theme.css`). It is too bright for white text. On solid accent surfaces use `text-text-on-accent`; for accent-coloured text use `text-text-accent`, never `text-accent-500` or `-600`. Secondary buttons rest on a mostly neutral border and go to the accent on hover (`button-key`, `button-secondary-*` tokens). New tokens that differ in `.dark` must also be added to `styles/theme-scope-light.css`.
- Button gradients resolve at `:root`, so overriding `--color-accent-*` on a subtree is not enough. `accentStyle()` in `checkout-widget.tsx` restates `--gradient-button-primary-{default,hover,active}` for the local accent, three stops each, matching `theme.css`. Any new accent-scoped surface must do the same. Button shadows need no restating (see Buttons).
- `styles/theme-scope-light.css` is generated from the `.dark` block of `styles/theme.css` (light value of every token it overrides). It makes `.theme-scope-light` stay light inside a dark page (widget preview, checkout). Regenerate it whenever `theme.css` changes. `theme="dark"` just uses the `.dark` class; `"auto"` adds neither.
- The checkout uses a `RadioGroup` grid for "Pay with", not BoardUI `Select`: popovers are portaled to `<body>` and escape the local theme scope and accent. Keep portaled components out of themed subtrees. (The dashboard `AssetSelect` is a Select and is fine because it is not themed.)
- Dates format in UTC (`lib/format.ts`, `lib/metrics.ts`) so SSR and hydration agree. Do not use local-time formatting for rendered dates.
- `cacheComponents: true` is on in `next.config.ts`: reading dynamic params (`params` in `/pay/[id]`) must happen under `<Suspense>`. See `app/pay/[id]/page.tsx`.
- Dashboard layout: `<main>` is the `@container`, and `Bento` is a 12-column grid. Spans use container queries (`@5xl:col-span-8`), not viewport breakpoints, because the sidebar changes the room available.
- A grid with no explicit columns has an implicit auto track that grows to its content and can overflow at phone width. Use `grid-cols-1` before `@xl:grid-cols-2`.
- Do not render two layouts and toggle them with CSS when they contain `TokenMark`. Token icons define SVG gradients by id, and an id that resolves inside a `display:none` subtree paints nothing. `PaymentsView` mounts the table or the list, never both.
- Every dashboard `page.tsx` exports `instant = false` because `DashboardShell` deliberately withholds pages until the workspace loads. It must be on the page; on the layout it has no effect here. New dashboard pages need it too. Without it, dev logs "Could not validate that a segment in your UI has instant navigation" on every dashboard route.
- `AppSidebar` and `TopBar` call `usePathname`, which suspends under a dynamic param unknown at build time, so the shell wraps each in `<Suspense>`. Removing a boundary fails `next build` on the `[id]/edit` routes.
- `dashboard.css` is unlayered, so it beats Tailwind utilities. A utility on an element that also has a class there silently loses.
- `react-aria` `FileTrigger` needs a Pressable child and BoardUI `Button` is a plain `<button>`, so the press never reaches it. The logo field uses a hidden file input.
- `shortAddress` only shortens `0x` addresses. A named account is unreadable cut in half.
- Brand accent `#00EC97` is 1.6:1 on white. Solid accent surfaces take `text-text-on-accent` and accent text takes `text-text-accent`. In charts use `var(--viz-primary)`, not the accent token. Asset hues in `dashboard.css` are the dataviz validated palette; the literal hex there is deliberate.
- React Aria closes popovers on scroll. A test that scrolls and clicks in one step sees a menu vanish; let the scroll settle first.
- `next dev` allows one server per project directory. A second one exits with "Another next dev server is already running".
- `NavButton` exists because BoardUI `ButtonLink` does a full page reload. Use it for in-app navigation styled as a button (it still lets modified clicks through).
- Token logos come from `@web3icons/react` in one place, `components/brand/token-mark.tsx`. Import per icon (`@web3icons/react/icons/tokens/TokenETH`); the package root would pull every logo into the bundle. The package is about 118 MB on disk but only imported icons ship. `showChain` draws a badge at `md` and above; the hero and checkout state the chain in text instead, which reads better. The icons share `clip-path` ids across the document and a reference to a hidden copy blanks the logo, so `TokenMark` disables that clip with `[&_g]:[clip-path:none]`.
- A token in `:root` makes no Tailwind utility until it is also re-exported in the `@theme inline` block of `styles/theme.css`; without that the class silently does nothing.
- `accentStyle()` must also restate every token derived from the accent, since they resolve at `:root`: `--color-text-on-accent` (flips by contrast, merchants can pick any colour), `--color-text-accent` (mixed with text-primary so it reads in any theme), and the secondary button colours.
- A token in `:root` needs a `@theme inline` export before its utility exists. `--color-button-secondary-*` was missing one, so secondary buttons silently fell back to a text-coloured border.
- `.dark` on a subtree works for tokens, and `.note` and `.foot` rely on it, but in a light page they still inherit `.site`'s light overrides, because `.dark .site` only matches a dark `<html>`. Anything `.site` sets (`--color-text-secondary`, `--color-border-focus-ring`) must be restated on them. Landing secondary text is stepped up in `.site`: BoardUI's neutral is 3.6 to 4.4:1 on these green grounds.
- Do not use `translate`, `transform` or reveal animations in the hero's machine; that rule is only relaxed below the hero, where nothing is measured. `Bus` is a straight stretched SVG and does not measure.
- `button-key` is named without the `bg-` prefix on purpose: `tailwind-merge` treats `bg-*` as a colour group and would drop the surface class beside it.
- Scope hero-only card rules to `.stage-dock .stage-card`; `.stage-card` is also the `/pay` card, which must keep the widget's 400px max width.
- BoardUI `RevenueChartCard` has `flex-1`; in a column flex parent pass `className="flex-none"` or its fixed height collapses and the chart disappears.
- `background-inner-default` is translucent in dark mode, so `CheckoutWidget` uses `bg-background-full` when `theme="dark"`. Dashboard panels use `bg-background-inner-default` because inputs vanish against `background-primary-default` in dark mode.
- Theme: saved under localStorage `boardui:theme`; `app/layout.tsx` applies `.dark` before paint with an inline script.
- Direction rules in AGENTS.md apply: use logical properties; code and URLs sit in `dir="ltr"` regions.

## UI checks

Whenever you add or change an overlay, dropdown, menu, popover, panel or layout, before calling it done:

- No stray horizontal scrollbars, anywhere. `overflow-y: auto` computes `overflow-x` to `auto`, so anything 1px too wide inside a scrolling panel grows a scrollbar. Fix the width; don't add `overflow-x: hidden`.
- Overlays are sized to their content and stay inside the viewport. A menu anchored to a full-width trigger uses `w-(--trigger-width)`; `Select` hugs its options and is never narrower than its trigger.
- Nothing is clipped when there is room. Prefer wrapping to `truncate`; keep `truncate` for one-line cells that can't wrap.
- Verify by actually opening it, at phone width (390) and large (1920 and 2560), in light and dark, with real scrollbars. Portaled overlays don't exist in a static scan, and Playwright hides scrollbars unless launched with `ignoreDefaultArgs: ["--hide-scrollbars"]`. Reproduce a bug before fixing it.
- Run this with the element open. It must return nothing except the intentional scrollers below, and `document.documentElement.scrollWidth` must not exceed `innerWidth`:

  ```js
  [...document.querySelectorAll("body *")].filter((e) => {
    const s = getComputedStyle(e), r = e.getBoundingClientRect();
    if (!r.width || !r.height || s.visibility === "hidden") return false;
    const scrolls = ["auto", "scroll"].includes(s.overflowX) && e.scrollWidth > e.clientWidth + 1;
    return scrolls || r.right > innerWidth + 1 || r.left < -1;
  });
  ```

  Decorative layers and anything inside a clipped box can match the viewport half; judge those by eye.
- Intentional horizontal scrollers, and the only ones: the Links table on phones (`min-w-[680px]`; it's opt-in, cards are the default) and code in a `<pre>` (the widget builder's snippet, a new API key). `Table`'s wrapper is `overflow-x-auto` so a table can never push the page, but it should only scroll in that one case.

## What's illustrative

Everything behind the dashboard and checkout is real. In test mode, `SimProvider` stands in for 1Click and no funds move. These remain illustrative in every mode:

| Thing | Status |
| --- | --- |
| Landing hero and `Products`, builder previews (`CheckoutWidget`) | Fixed prices and a fake timeline. Labelled. They record nothing. |
| `FlowChannels`, `Bus` | Decorative. |
| Landing note, `lumen.studio/print`, display domains | Fictional. The note is stamped SPECIMEN. |
| Trust figures in `lib/site.ts` | "8 chains" matches `ASSETS`. "~1 min" is NEAR's estimate on most routes, not our measurement. |
| The name "Gateway" | Working name. |
| `/terms`, `/privacy` | Drafts, saying so, until a lawyer has read them. |

## Current status / next up

- Verification: CI (`.github/workflows/ci.yml`) runs lint, typecheck, tests, build, end-to-end and a production dependency audit. `test:live` and `test:mutation` run by hand: run both before any change to money code ships.
- Git: `origin` is github.com/obsrvgmi/gateway (public), default branch `main`. README images live in `.github/assets/`; the social preview there must be uploaded by hand in repo settings. `LICENSE` is an all-rights-reserved notice until the owner picks a licence.
- Not done, and needs a person: NEAR partner key and written answers, a lawyer's read, a canary with real funds, hosting, a real name, publishing `@gateway/react`. See `docs/runbooks/going-live.md`.
- Known gaps: `useUnsavedGuard` can't stop the browser's Back button. End-to-end runs on Chromium and Playwright's WebKit, which stands in for Safari but isn't Safari, so a real iPhone still needs a look. Merchant wallets must be EOAs. Bitcoin is closed in live mode. Known limits are listed in the design.

## Working in parallel

- Claim work in small, short-lived branches; keep PRs focused.
- Do not both reformat vendored BoardUI files (`components/base|application|foundations`, `styles/theme.css`, `utils`, `hooks`). Add via the CLI; edit only when needed and keep diffs minimal.
- `lib/types.ts`, `lib/store.ts` and `server/db/schema.ts` are the merge hot spots. Announce changes to them and land them first and small.
- A schema change needs `npm run db:generate` and a committed migration. Migrations must stay additive, so a rollback runs on the newer schema.
- Adding a guard means adding its line to `scripts/mutate-guards.mjs`.
