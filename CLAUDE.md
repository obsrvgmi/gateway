# CLAUDE.md

@AGENTS.md

`AGENTS.md` holds the BoardUI design rules (semantic tokens, composite type utilities, `cx()`, component-first) and the Next.js warning: this Next version differs from your training data, so read the relevant guide in `node_modules/next/dist/docs/` before writing framework code. Parts of it are auto-generated (the Next.js block is rewritten by `next dev`; the BoardUI block is managed by the BoardUI CLI). Do not hand-edit those blocks.

## Scope

A `CLAUDE.md` in a parent directory of your checkout may describe a different product. Its product, architecture and design instructions do not apply here. This file wins for this repo.

## Keep this file current

Any change to routes, the data model, `lib/`, shared components, conventions, or the Mock vs real table below must update this file in the same change.

Automation: `.claude/settings.json` registers a Stop hook, `.claude/hooks/claude-md-sync.sh`. It blocks once when uncommitted files in `app`, `lib`, `components/dashboard`, `components/checkout`, `components/marketing`, `components/brand` or `styles` are newer than this file, then lets the agent stop if nothing needs documenting. It only runs in Claude Code sessions; people on other tools must follow the rule by hand.

## What this is

"Gateway" (working name): a frontend-only mock of a crypto payment gateway. Two products: Payment Links (hosted checkout at `/pay/[id]`) and an embeddable Payment Collection Widget. The customer pays with any supported asset; the merchant receives their chosen asset, routed by NEAR Intents (in the story only). There is no backend and no blockchain call anywhere.

Stack: Next.js 16.4 App Router, React 19.3, Tailwind CSS v4, TypeScript, BoardUI, React Aria, Recharts, TanStack Table, Inter via `next/font`, `qrcode.react`, `@web3icons/react` (exact pin; token and network logos).

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npx boardui@latest add <name> --yes   # add a BoardUI component into components/
```

## Repo map

| Path | Owner |
| --- | --- |
| `app/` | ours: routes (thin; pages render a view component) |
| `lib/` | ours: types, store, seed data, quote, metrics, formatting |
| `components/checkout/` | ours: `CheckoutWidget`, `HostedCheckout` |
| `components/marketing/` | ours: landing `Hero`, `SiteNav`, `Products` + `SiteFooter`, `FlowChannels` (SVG grooves) |
| `components/dashboard/` | ours: shell, sidebar, `ui.tsx` primitives (`Bento`, `Panel`, `DeltaChip`), `charts.tsx`, `payment-drawer.tsx`, `live.ts` simulator, `csv.ts`, `fmt.ts`, `skeletons.tsx`, `asset-select.tsx`, `views/*` |
| `components/brand/` | ours: `Logo`, `LogoMark`, `TokenMark`, `Rosette` (guilloche seal) |
| `components/nav-button.tsx` | ours |
| `styles/` | `theme.css`, `typography.css`, `globals.css` are BoardUI; `theme-scope-light.css` is generated (see gotchas) |
| `components/base/`, `components/application/`, `components/foundations/`, `utils/`, `hooks/` | vendored BoardUI source. Prefer adding via the CLI over editing; do not reformat. |

BoardUI extras pulled in by `add` and unused by our routes (safe to remove): `dashboard-sidebar`, `dashboard-team-menu`, `dashboard-user-menu`, `components/application/settings/*`, `data-table`, and `public/ai-chat/`. `.cursor/rules/boardui.mdc` (Cursor copy of the BoardUI rules) and `.agents/skills/` (design skills for agents) are tooling, not app code.

Routes:

| Route | File | Notes |
| --- | --- | --- |
| `/` | `app/page.tsx` | Landing: `SiteNav`, `Hero` (`FlowChannels` + live `CheckoutWidget`), `Products` (Payment Links and Payment Widgets), `SiteFooter` |
| `/pay/[id]` | `app/pay/[id]/page.tsx` | Hosted checkout for a payment link; records the payment on settle |
| `/dashboard` | `app/dashboard/page.tsx` | Overview: range control, volume chart or table, KPIs, payouts, live feed, route flow, breakdowns, setup checklist |
| `/dashboard/links` | `.../links/page.tsx` | Link cards or table, search, status filter, pause, delete |
| `/dashboard/links/new` | `.../links/new/page.tsx` | Create link, live preview, share URL + QR |
| `/dashboard/widgets` | `.../widgets/page.tsx` | Widget cards with thumbnail, search, status filter, pause, delete with undo |
| `/dashboard/widgets/new` | `.../widgets/new/page.tsx` | Customize widget, preview, embed snippet |
| `/dashboard/widgets/[id]/edit` | `.../widgets/[id]/edit/page.tsx` | Same builder as `new`, reopening a saved widget |
| `/dashboard/payments` | `.../payments/page.tsx` | Summary strip, filters and chips, sortable table (list on narrow screens), bulk actions, status and asset rail, drawer with timeline. `?source=<id>` preselects a source |
| `/dashboard/settings` | `.../settings/page.tsx` | Payouts, branding, webhooks, API keys, team, email alerts, appearance, demo data |

Each page renders a `components/dashboard/views/*` component; `app/dashboard/layout.tsx` wraps them in `DashboardShell` and imports `app/dashboard/dashboard.css` (chart hues, `--viz-primary`, a darker focus ring, skeleton and feed motion).

## Architecture

- **State**: `lib/store.ts`. A module-level `state` read through `useSyncExternalStore` (`useGateway()`), mutated only via `actions.*`, persisted to `localStorage` key `gateway:demo-state:v2`. The server snapshot is always `SEED_STATE`; saved state is restored on first subscribe, so the first client render matches SSR. `useGatewayReady()` is false until then, and `DashboardShell` mounts views only once it is true, so any view may seed `useState` from the store. Other tabs stay in sync through the `storage` event. Changing the shape of `GatewayState` means bumping the key version (no migration exists). `newId(prefix)` makes ids like `lnk_ab12cd`.
- **Seed**: `lib/seed.ts`. Links, widgets, settings are literals; payments come from a seeded `mulberry32` PRNG over 730 days, and a payment only lands on a source that was open that day. `DEMO_NOW` is a fixed instant (2026-11-05 18:00 UTC) and all seeded dates and metric windows are measured from it, not `Date.now()`, so server and client render identical data and the charts do not drift. New links use the real clock. `actions.recordPayment` restamps each payment just after the newest one, so payments stay on the demo timeline whatever the wall clock says.
- **Metrics**: `lib/metrics.ts` derives everything from the payments array. `rangeReport(payments, range)` returns buckets that partition the window, so they add up to the headline. The last bucket is flagged `partial` and its comparison stops at the same moment in the earlier period, so a running day or month is never measured against a whole one. Success rate leaves in-flight payments out of the denominator. `metricsNow` is the later of `DEMO_NOW` and the newest payment.
- **Quotes**: `lib/assets.ts`. `ASSETS` (mock USD prices, display decimals, chip tone), `PAY_ASSETS`, `RECEIVE_ASSETS`, and `quote(usd, pay, receive)` which adds a flat `ROUTE_FEE` (0.3%) only when the assets differ.
- **`CheckoutWidget`** (`components/checkout/checkout-widget.tsx`): the single checkout UI, used by the landing hero, the link preview, the widget preview, and `HostedCheckout` (`/pay/[id]`). It is controlled or uncontrolled for the pay asset, runs a fake three-step timeline (timers, no network), and calls `onSettled`. Only `HostedCheckout` passes `onSettled` and records a payment; previews and the hero do not.
- **Loop**: create a link (`link-new`) -> `actions.addLink` -> share URL `/pay/<id>` (+ QR) -> open it, pay, `actions.recordPayment` -> appears in Payments and Overview. Widgets: create (`widget-new`) -> `actions.addWidget` -> copy embed snippet from `lib/embed.ts`. There is no embeddable runtime, so widget payments exist only as seed data.
- **Landing stage**: `Hero` owns pay asset, receive asset and checkout step, and passes them to `CheckoutWidget` (`showAssetPicker={false}`, `onStepChange`) and `FlowChannels`.
  - Layout: `styles/stage.css` (ours; `/pay` reuses it) defines the system at its top. Pay plate, card and receive plate share one row and height, side plates are equal, and the card sits on the page's centre axis. `@media (max-height: 820px)` keeps the hero above the fold on short laptops. Below 1100px the same machine rotates to vertical and the CTAs move above it.
  - Geometry: `FlowChannels` measures the centres of `[data-flow-pin=SYMBOL]`, `[data-flow-dock=SYMBOL]`, `[data-flow-out]` and `[data-flow-sink]` and routes each channel between them like a PCB trace: straight, one 45 degree jog with `BEND_RADIUS` corners, straight. All lanes share one jog centre, so they stay ordered and cannot cross. Do not put transforms on these elements or their ancestors, even in the load animation: that is why `stage-object` is opacity only. `--flow-axis` in `stage.css` keeps ports level with the centre of the rail's rows; if the rail's caption block changes height, change it too. `SOURCES` in `hero.tsx` is ordered by hue.
  - Render: an SVG under the plates, so a channel is lost beneath its socket ring with no seam while its path still ends at the node centre. Each channel is stacked strokes of constant width (lip, wall, floor) plus a lit layer and a four-dash comet. The chosen channel is lit; the rest are near-neutral. Motion is CSS only, driven by `data-state` and `pathLength={1}`, so no JavaScript runs per frame. `stroke-dashoffset` needs `px` units inside `calc()`, or the animation silently does nothing. The guilloche belongs to the plates and ground; keep channels plain. There is no WebGL or canvas on the landing page, so no fallback path exists.
  - Plates: `.stage-plate` and `.stage-card` are the page's one material: solid fill, machined bezel via a `border-box` gradient, a printed hairline (`::before`) and an engraved pattern (`::after`, applied as a mask so `--plate-engrave` themes it). `/pay` and the product stage use the same classes. `.stage-rule` is the double hairline divider.
  - Behaviour: the pause button (rendered twice; CSS shows one per breakpoint) stops the pulses. `prefers-reduced-motion` removes pulses and the fill animation; lit states still show. Until the visitor interacts, `Hero` steps through assets every 3.2s.
- **`CheckoutWidget` states**: idle, running and settled share one grid cell and the idle layer stays mounted (`invisible`, `inert`), so the card never changes size. Keep new states inside that height; the hero's ports depend on it.
- **`Products`**: a React Aria tab switcher beside one fixed-height stage. The mock shows and the QR encodes the reserved domain in `DISPLAY_LINK`; only Copy link, Email and the link's href use the working `/pay/lnk_8fk2m1` URL. The widget demo is a live `CheckoutWidget`, and `ACCENTS` must stay mid-tones so every swatch reads on both grounds. It sets `buttonLabel` so the page keeps one button named "Pay ...".
- **Other lib**: `format.ts` (USD/token/date formatting, `shortAddress`), `use-origin.ts` (SSR-safe `window.location.origin`), `site.ts` (name, tagline, marketing figures).

## Gotchas

- **Brand accent is `#00EC97`** (`--color-accent-500` in `styles/theme.css`). It is too bright for white text. On solid accent surfaces use `text-text-on-accent`; for accent-coloured text use `text-text-accent`, never `text-accent-500` or `-600`. Secondary buttons use the accent as a border (`button-secondary-*` tokens). New tokens that differ in `.dark` must also be added to `styles/theme-scope-light.css`.
- Button gradients resolve at `:root`, so overriding `--color-accent-*` on a subtree is not enough. `accentStyle()` in `checkout-widget.tsx` restates `--gradient-button-primary-{default,hover,active}` for the local accent. Any new accent-scoped surface must do the same.
- `styles/theme-scope-light.css` is generated from the `.dark` block of `styles/theme.css` (light value of every token it overrides). It makes `.theme-scope-light` stay light inside a dark page (widget preview, checkout). Regenerate it whenever `theme.css` changes. `theme="dark"` just uses the `.dark` class; `"auto"` adds neither.
- The checkout uses a `RadioGroup` grid for "Pay with", not BoardUI `Select`: popovers are portaled to `<body>` and escape the local theme scope and accent. Keep portaled components out of themed subtrees. (The dashboard `AssetSelect` is a Select and is fine because it is not themed.)
- Dates format in UTC (`lib/format.ts`, `lib/metrics.ts`) so SSR and hydration agree. Do not use local-time formatting for rendered dates.
- `cacheComponents: true` is on in `next.config.ts`: reading dynamic params (`params` in `/pay/[id]`) must happen under `<Suspense>`. See `app/pay/[id]/page.tsx`. `HostedCheckout` also snapshots `Date.now()` in `useState` to evaluate link expiry without hydration mismatch.
- Dashboard layout: `<main>` is the `@container`, and `Bento` is a 12-column grid. Spans use container queries (`@5xl:col-span-8`), not viewport breakpoints, because the sidebar changes the room available.
- A grid with no explicit columns has an implicit auto track that grows to its content and can overflow at phone width. Use `grid-cols-1` before `@xl:grid-cols-2`.
- Do not render two layouts and toggle them with CSS when they contain `TokenMark`. Token icons define SVG gradients by id, and an id that resolves inside a `display:none` subtree paints nothing. `PaymentsView` mounts the table or the list, never both.
- Every dashboard `page.tsx` exports `instant = false` because `DashboardShell` deliberately withholds pages until the store restores. It must be on the page; on the layout it has no effect here. New dashboard pages need it too. Without it, dev logs "Could not validate that a segment in your UI has instant navigation" on every dashboard route.
- `AppSidebar` calls `usePathname`, which suspends under a dynamic param unknown at build time, so the shell wraps it in `<Suspense>`. Removing that boundary fails `next build` on `/dashboard/widgets/[id]/edit`.
- Brand accent `#00EC97` is 1.6:1 on white. Solid accent surfaces take `text-text-on-accent` and accent text takes `text-text-accent`. In charts use `var(--viz-primary)`, not the accent token. Asset hues in `dashboard.css` are the dataviz validated palette; the literal hex there is deliberate.
- React Aria closes popovers on scroll. A test that scrolls and clicks in one step sees a menu vanish; let the scroll settle first.
- `next dev` allows one server per project directory. A second one exits with "Another next dev server is already running".
- `NavButton` exists because BoardUI `ButtonLink` does a full page reload. Use it for in-app navigation styled as a button (it still lets modified clicks through).
- Token logos come from `@web3icons/react` in one place, `components/brand/token-mark.tsx`. Import per icon (`@web3icons/react/icons/tokens/TokenETH`); the package root would pull every logo into the bundle. The package is about 118 MB on disk but only imported icons ship. `showChain` draws a badge at `md` and above; the hero and checkout state the chain in text instead, which reads better. The icons share `clip-path` ids across the document and a reference to a hidden copy blanks the logo, so `TokenMark` disables that clip with `[&_g]:[clip-path:none]`.
- A token in `:root` makes no Tailwind utility until it is also re-exported in the `@theme inline` block of `styles/theme.css`; without that the class silently does nothing.
- `accentStyle()` must also restate every token derived from the accent, since they resolve at `:root`: `--color-text-on-accent` (flips by contrast, merchants can pick any colour), `--color-text-accent` (mixed with text-primary so it reads in any theme), and the secondary button colours.
- A token in `:root` needs a `@theme inline` export before its utility exists. `--color-button-secondary-*` was missing one, so secondary buttons silently fell back to a text-coloured border.
- Scope hero-only card rules to `.stage-dock .stage-card`; `.stage-card` is also the `/pay` card, which must keep the widget's 400px max width.
- BoardUI `RevenueChartCard` has `flex-1`; in a column flex parent pass `className="flex-none"` or its fixed height collapses and the chart disappears.
- `background-inner-default` is translucent in dark mode, so `CheckoutWidget` uses `bg-background-full` when `theme="dark"`. Dashboard panels use `bg-background-inner-default` because inputs vanish against `background-primary-default` in dark mode.
- Theme: saved under localStorage `boardui:theme`; `app/layout.tsx` applies `.dark` before paint with an inline script.
- Direction rules in AGENTS.md apply: use logical properties; code and URLs sit in `dir="ltr"` regions.

## Mock vs real

| Thing | Status |
| --- | --- |
| Auth | Fake. "Login" and "Get Started" are links to `/dashboard`; "Log out" goes to `/`. No session. |
| Payments | Fake. A timed UI sequence; no wallet connection, no transactions. Payer address is a hard-coded constant. |
| Quotes and rates | Fake. Static USD prices and a flat 0.3% route fee in `lib/assets.ts`. No NEAR Intents call. |
| Data | Seeded plus `localStorage`; single browser only. No server, no API. |
| Live activity | Simulated by `components/dashboard/live.ts`, in-page timers only. Writes real store records (marked `simulated`), capped at 12 per Overview visit, off by default under reduced motion. Settlement is compressed to about 4.5s while recording a normal `settleSeconds`. |
| Payment timeline | Derived from status and `settleSeconds` in `paymentTimeline`. No chain events exist. |
| Refunds | "Mark refunded" only changes status. No funds move. |
| Route fees | Derived: what the customer paid above the price, from the mock 0.3% spread. |
| Webhooks, team, email alerts (Settings) | Saved locally. Nothing is sent, invited or delivered. |
| Branding | Accent is the default for new widgets. Support email and statement name are stored and used nowhere else. The hosted checkout does not read branding. |
| API keys (Settings) | Display only; nothing authenticates with them. |
| `/widget.js` and `@gateway/react` in the embed snippet | Do not exist. Strings only (`lib/embed.ts`). |
| `FlowChannels` | Decorative. It reflects the fake checkout timeline; no real route or solver data. |
| `Products` | The copy link, QR, email link and widget controls work. The site in the widget mock, `lumen.studio/print`, and the display domain in the link mock are fictional. The page states that payments are simulated. |
| Trust figures in `lib/site.ts` ("25+ chains", "~30s") | Placeholders. "~30s" is a design goal. Seeded `settleSeconds` is random 18 to 41. |
| "Non-custodial" copy | Describes the intended product, not this mock. |
| The name "Gateway" and merchant "Lumen Studio" | Working name and demo merchant. |

## Current status / next up

- Verification: `npx tsc --noEmit` and `npm run build` pass. Dashboard flows are covered by a throwaway Playwright script, not committed. `npm run lint` reports 5 errors and 2 warnings, all in vendored BoardUI files (`components/application/dashboard/dashboard-user-menu.tsx`, `components/application/data-table/data-table.tsx`, `components/application/settings/plan-art-flame.tsx`, `components/application/settings/settings-modal.tsx`, `components/base/date-picker/date-picker.tsx`, `components/base/date-picker/shared.tsx`); files we own are clean. There is no test suite; flows were checked with a throwaway Playwright script that is not committed.
- Git: no commits yet; `origin` points at github.com/obsrvgmi/gateway; nothing has been pushed. `package.json` carries a description and keywords.
- Done: landing, link creation/share/pay, widget customization and embed snippet (UI only), payments table, overview metrics, settings, demo-data reset.
- Not built: command palette, notification centre, breadcrumbs, keyboard shortcuts, link and widget detail pages, link editing, a stepped creation flow.
- Known gap: the Payments "Custom range" option opens the two-month `DateRangePicker` at every width, and it has not been checked on phones.
- Next (nothing started): a real embeddable widget bundle, a backend for links and payments, auth, real NEAR Intents quoting and settlement.

## Working in parallel

- Claim work in small, short-lived branches; keep PRs focused.
- Do not both reformat vendored BoardUI files (`components/base|application|foundations`, `styles/theme.css`, `utils`, `hooks`). Add via the CLI; edit only when needed and keep diffs minimal.
- `lib/types.ts` and `lib/store.ts` are the merge hot spots (data model and every action). Announce changes to them and land them first and small.
- Seed data in `lib/seed.ts` changes alter every chart; call it out in the PR.
