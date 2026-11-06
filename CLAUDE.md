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
| `lib/` | ours: types, store, seed data, quote, metrics, `payouts.ts` (the balance ledger), `attention.ts` (Overview's "Needs you"), formatting |
| `components/checkout/` | ours: `CheckoutWidget`, `HostedCheckout` |
| `components/marketing/` | ours: landing `Hero`, `SiteNav` (scroll-aware header and mobile sheet), `Products` (the note and the console), `SiteFooter`, `FlowChannels` (SVG grooves, exports `Channel`), `Bus` (the channel down the page's axis) |
| `components/lazy-toaster.tsx` | ours: loads the toast stack on the first toast |
| `components/dashboard/` | ours: shell, sidebar, `top-bar.tsx`, `command-palette.tsx`, `preload.ts` (lazy overlay loaders, idle preload), `unsaved.tsx` (`useUnsavedGuard`, `guardedPush`), `volume-chart.tsx` (the only Recharts consumer), `ui.tsx` primitives (`Bento`, `Panel`, `Stat`, `PanelLink`, `DeltaChip`, `SimulatedTag`, `useWideMain`), `charts.tsx`, `position-strip.tsx`, `payment-drawer.tsx`, `payout-dialog.tsx`, `payout-sim.ts`, `live.ts` simulator, `csv.ts`, `fmt.ts`, `skeletons.tsx`, `asset-select.tsx`, `views/*` |
| `components/brand/` | ours: `Logo`, `LogoMark`, `TokenMark`, `Rosette` (guilloche seal) |
| `components/nav-button.tsx` | ours |
| `styles/` | `theme.css`, `typography.css`, `globals.css` are BoardUI, with our button depth recipe at the end of `theme.css`; `theme-scope-light.css` is generated (see gotchas); `stage.css` is the hero and the plate material `/pay` shares; `landing.css` is everything else on `/`, imported by `app/page.tsx` only |
| `public/guilloche/` | ours: static SVG art used as CSS masks (`rosette`, `rosette-ring`, `rosette-print`, `wordmark`). Generated once with a throwaway script: the rosettes from the formula in `components/brand/rosette.tsx`, the wordmark from Inter Bold outlines. Masks, not inline SVG, so they add no HTML weight |
| `components/base/`, `components/application/`, `components/foundations/`, `utils/`, `hooks/` | vendored BoardUI source. Prefer adding via the CLI over editing; do not reformat. |

BoardUI extras pulled in by `add` and unused by our routes (safe to remove): `dashboard-sidebar`, `dashboard-team-menu`, `dashboard-user-menu`, `components/application/settings/*`, `data-table`, and `public/ai-chat/`. `.cursor/rules/boardui.mdc` (Cursor copy of the BoardUI rules) and `.agents/skills/` (design skills for agents) are tooling, not app code.

Routes:

| Route | File | Notes |
| --- | --- | --- |
| `/` | `app/page.tsx` | Landing: `SiteNav`, `Hero` (`FlowChannels` + live `CheckoutWidget`), `Products` (`#links` the note, `#widgets` the console), `SiteFooter` |
| `/pay/[id]` | `app/pay/[id]/page.tsx` | Hosted checkout for a payment link; records the payment on settle |
| `/dashboard` | `app/dashboard/page.tsx` | Overview: position strip, volume chart or table (metric, compare, bars open that period), "Needs you", live feed, KPIs, route flow, breakdowns, setup checklist. Figures link into filtered Payments |
| `/dashboard/links` | `.../links/page.tsx` | Link cards or table, search, status filter, pause, delete |
| `/dashboard/links/new` | `.../links/new/page.tsx` | Create link, live preview, share URL + QR |
| `/dashboard/links/[id]/edit` | `.../links/[id]/edit/page.tsx` | Same form as `new`, reopening a saved link |
| `/dashboard/widgets` | `.../widgets/page.tsx` | Widget cards with thumbnail, search, status filter, pause, delete with undo |
| `/dashboard/widgets/new` | `.../widgets/new/page.tsx` | Customize widget (identity, logo, amount, suggested amounts, accepted assets, look, email, after-payment), preview on a light or dark page at two widths, embed snippet |
| `/dashboard/widgets/[id]/edit` | `.../widgets/[id]/edit/page.tsx` | Same builder as `new`, reopening a saved widget |
| `/dashboard/payments` | `.../payments/page.tsx` | Summary strip, filters and chips, sortable table (list on narrow screens), bulk actions, status and asset rail, drawer with timeline. Filters seed from `?q= status= asset= type= source= chain= range=` and `from= to= label=` (ms, for one chart bar) |
| `/dashboard/payouts` | `.../payouts/page.tsx` | Balance, next payout, schedule, refund window, hold releases, destinations, runs, history, pay-out dialog, retry, CSV |
| `/dashboard/settings` | `.../settings/page.tsx` | Tabs (`?tab=`): business and branding, developers, team and alerts, workspace and demo data. Payout settings live on `/dashboard/payouts` |

Each page renders a `components/dashboard/views/*` component; `app/dashboard/layout.tsx` wraps them in `DashboardShell` and imports `app/dashboard/dashboard.css` (chart hues, `--viz-primary`, a darker focus ring, the surface restatement, rail, top bar and strip styles, skeleton and feed motion). `app/dashboard/error.tsx` is the error boundary.

## Architecture

- **State**: `lib/store.ts`. A module-level `state` read through `useSyncExternalStore` (`useGateway()`), mutated only via `actions.*`, persisted to `localStorage` key `gateway:demo-state:v3`. The server snapshot is always `SEED_STATE`; saved state is restored on first subscribe, so the first client render matches SSR. `useGatewayReady()` is false until then, and `DashboardShell` mounts views only once it is true, so any view may seed `useState` from the store. Other tabs stay in sync through the `storage` event. Changing the shape of `GatewayState` means bumping the key version (no migration exists). `newId(prefix)` makes ids like `lnk_ab12cd`.
- **Seed**: `lib/seed.ts`. Payouts are derived from the payments after generation (a Monday batch per asset, newest USDT batch failed), so they do not touch the RNG and charts are unchanged. Links, widgets, settings are literals; payments come from a seeded `mulberry32` PRNG over 730 days, and a payment only lands on a source that was open that day. `DEMO_NOW` is a fixed instant (2026-11-05 18:00 UTC) and all seeded dates and metric windows are measured from it, not `Date.now()`, so server and client render identical data and the charts do not drift. New links use the real clock. `actions.recordPayment` restamps each payment just after the newest one, so payments stay on the demo timeline whatever the wall clock says.
- **Metrics**: `lib/metrics.ts` derives everything from the payments array. `rangeReport(payments, range)` returns buckets that partition the window, so they add up to the headline. The last bucket is flagged `partial` and its comparison stops at the same moment in the earlier period, so a running day or month is never measured against a whole one. Success rate leaves in-flight payments out of the denominator. `metricsNow` is the later of `DEMO_NOW` and the newest payment.
- **Money model** (`lib/payouts.ts`): Gateway never holds funds, so there is no Gateway balance. Payments settle into the merchant's own settlement account and a payout sweeps it to a destination. `ledger()` derives everything from `payments` and `payouts`: arriving (processing payments), on hold (settled within `holdDays`, the merchant's own refund window, not a Gateway reserve), available (cleared, minus payouts that did not fail, per asset), paid out. Do not write copy that implies custody: say "settlement account" and "refund window", not "wallet balance with us" or "reserve". `settings.walletAddress` is the default destination's address; `setDefaultDestination` keeps them in step. `actions.addPayout` stamps on the demo timeline. `payout-sim.ts` lands a payout on a timer outside the dialog, and `finishSimulated` lands any left processing on restore.
- **Dashboard surfaces**: `dashboard.css` restates BoardUI's surface, border and text tokens rather than adding parallel ones, so vendored components follow. Those tokens and the `--viz-*` hues sit on `html:has(.dash-root)`, not `.dash-root`, because modals, drawers and popovers portal to `<body>`. `.dash-plate` is a panel, `.dash-well` a recess, `stage-plate` is reserved for the position strip and balance. Texture means "not final yet" everywhere: the chart's running bar and the balance bar's arriving segment.
- **Quotes**: `lib/assets.ts`. `ASSETS` (mock USD prices, display decimals, chip tone), `PAY_ASSETS`, `RECEIVE_ASSETS`, and `quote(usd, pay, receive)` which adds a flat `ROUTE_FEE` (0.3%) only when the assets differ.
- **`CheckoutWidget`** (`components/checkout/checkout-widget.tsx`): the single checkout UI, used by the landing hero, the link preview, the widget preview, and `HostedCheckout` (`/pay/[id]`). It is controlled or uncontrolled for the pay asset, runs a fake three-step timeline (timers, no network), and calls `onSettled`. Only `HostedCheckout` passes `onSettled` and records a payment; previews and the hero do not.
- **Loop**: create a link (`link-new`) -> `actions.addLink` -> share URL `/pay/<id>` (+ QR) -> open it, pay, `actions.recordPayment` -> appears in Payments and Overview. Then the payment sits on hold for `holdDays`, becomes available, and `PayoutDialog` -> `actions.addPayout` sweeps it. Widgets: create (`widget-new`) -> `actions.addWidget` -> copy embed snippet from `lib/embed.ts`, which only prints options that differ from the default. There is no embeddable runtime, so widget payments exist only as seed data.
- **Landing stage**: `Hero` owns pay asset, receive asset and checkout step, and passes them to `CheckoutWidget` (`showAssetPicker={false}`, `onStepChange`) and `FlowChannels`.
  - Layout: `styles/stage.css` (ours; `/pay` reuses it) defines the system at its top. Pay plate, card and receive plate share one row and height, side plates are equal, and the card sits on the page's centre axis. `@media (max-height: 820px)` keeps the hero above the fold on short laptops. Below 1100px the same machine rotates to vertical and the CTAs move above it.
  - Geometry: `FlowChannels` measures the centres of `[data-flow-pin=SYMBOL]`, `[data-flow-dock=SYMBOL]`, `[data-flow-out]` and `[data-flow-sink]` and routes each channel between them like a PCB trace: straight, one 45 degree jog with `BEND_RADIUS` corners, straight. All lanes share one jog centre, so they stay ordered and cannot cross. Do not put transforms on these elements or their ancestors, even in the load animation: that is why `stage-object` is opacity only. `--flow-axis` in `stage.css` keeps ports level with the centre of the rail's rows; if the rail's caption block changes height, change it too. `SOURCES` in `hero.tsx` is ordered by hue.
  - Render: an SVG under the plates, so a channel is lost beneath its socket ring with no seam while its path still ends at the node centre. Each channel is stacked strokes of constant width (lip, wall, floor) plus a lit layer and a four-dash comet. The chosen channel is lit; the rest are near-neutral. Motion is CSS only, driven by `data-state` and `pathLength={1}`, so no JavaScript runs per frame. `stroke-dashoffset` needs `px` units inside `calc()`, or the animation silently does nothing. The guilloche belongs to the plates and ground; keep channels plain. There is no WebGL or canvas on the landing page, so no fallback path exists.
  - Plates: `.stage-plate` and `.stage-card` are the page's one material: solid fill, machined bezel via a `border-box` gradient, a printed hairline (`::before`) and an engraved pattern (`::after`, applied as a mask so `--plate-engrave` themes it). `/pay` and the product stage use the same classes. `.stage-rule` is the double hairline divider.
  - Behaviour: the pause button (rendered twice; CSS shows one per breakpoint) stops the pulses. `prefers-reduced-motion` removes pulses and the fill animation; lit states still show. Until the visitor interacts, `Hero` steps through assets every 3.2s.
- **`CheckoutWidget` states**: idle, running and settled share one grid cell and the idle layer stays mounted (`invisible`, `inert`), so the card never changes size. Keep new states inside that height; the hero's ports depend on it.
- **Page structure**: `/` is one object. `styles/landing.css` documents it at its top. A channel (`Bus`) leaves the hero's seam, runs down the centre axis under every plate (`.bus-spine`, 1100px and up; short `.bus-stub`s below that) and ends at the seal in the footer. Text sits either side of the axis and swaps sides between scenes, as the hero's headline does, so keep the axis clear of text at 1100px and up. The spine's lit layer fills from `scroll(root)`.
- **`Products`**: two full-width scenes, both always visible; there are no tabs. `Scene` is the shared head.
  - `#links`, `PaymentNote`: a payment link drawn as a cheque, in the same ink in both themes (`.dark` on the element scopes its tokens). Every size is in `cqi`, so it scales as one printed object; below a 44rem container it stacks as a portrait note. Two rosettes counter-rotate on a view timeline, which is what makes the moire run. The foil thread uses `--spectrum`, the rail's hues, and shifts with the pointer. Pointer values are written to `--mx`/`--my` directly, never React state. The SPECIMEN stamp is the page's honesty: keep it legible. The tray below holds Copy link and Email. The mock shows and the QR encodes the reserved domain in `DISPLAY_LINK`; only Copy link, Email and the link's href use the working `/pay/lnk_8fk2m1` URL.
  - `#widgets`, `WidgetPlate`: a console of real controls (accent, corners, receive asset) beside a merchant page with a live `CheckoutWidget`. `--brand` on the plate tints the shop's hairlines and wall, so an accent never clashes with the green. `ACCENTS` must stay mid-tones so every swatch reads on both grounds. It sets `buttonLabel` so the page keeps one button named "Pay ...".
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

- Toasts: every consequential action confirms. Pass an `id` where a repeat would stack (copy, export, settings toggles); use `SIMULATED` from `ui.tsx`, or say so in the description, wherever copy could read as money moving. Cheap reversals get an `Undo` action (pause, delete a link or widget, remove a destination, clear or restore demo data via `actions.restoreSnapshot`); confirm with `AlertDialog` only what can't be undone (revoke a key, mark refunded, clear data). The stack sits at the top on phones so it can't cover stacked modal footers.
- Modals and drawers: `.modal-surface` and `.modal-backdrop` in `dashboard.css` restyle the vendored overlays. The panel is white in light mode because `--color-background-full` is the mint page ground here.
- A payout's outcome: `runPayout` toasts on completion unless the dialog is watching it (`watchPayout`).
- `useUnsavedGuard(dirty)` covers links, menus (`guardedPush`), the palette, reload and tab close. Any new `router.push` reachable while a form is dirty must use `guardedPush`. The browser's Back button isn't covered: the App Router can't block history navigation.
- `app/dashboard/template.tsx` plays the opacity-only route settle (`.dash-route`) and holds the page's flex column; views still return fragments.
- `PageSkeleton` is chosen by route. If a route's layout changes, change its skeleton too.
- Overview on phones: below 768px of `main`, the seven breakdowns and the setup steps wait behind a control. They unmount rather than hide, because of the `TokenMark` rule below.

## Gotchas

- Vendored `Select`, `Input` and `Textarea` pass a string `label` on as `aria-label` as well. Next keeps visited routes in a hidden `Activity`; layout effects don't run there, so React Aria's label slot stays empty and it warns in dev about a field that does have a label.
- `DateRangePicker` shows one month and no presets at 860px and below, because the two-month popover is 814px wide. The choice is made once, when it mounts.
- `app/error.tsx` exists because `app/dashboard/error.tsx` can't catch its own layout, and the rail reads the store there. Both offer "Restore demo data", which is the real fix for damaged saved state.
- Safari has no `requestIdleCallback`; `preloadDashboardExtras` falls back to a timer.

- **Brand accent is `#00EC97`** (`--color-accent-500` in `styles/theme.css`). It is too bright for white text. On solid accent surfaces use `text-text-on-accent`; for accent-coloured text use `text-text-accent`, never `text-accent-500` or `-600`. Secondary buttons rest on a mostly neutral border and go to the accent on hover (`button-key`, `button-secondary-*` tokens). New tokens that differ in `.dark` must also be added to `styles/theme-scope-light.css`.
- Button gradients resolve at `:root`, so overriding `--color-accent-*` on a subtree is not enough. `accentStyle()` in `checkout-widget.tsx` restates `--gradient-button-primary-{default,hover,active}` for the local accent, three stops each, matching `theme.css`. Any new accent-scoped surface must do the same. Button shadows need no restating (see Buttons).
- `styles/theme-scope-light.css` is generated from the `.dark` block of `styles/theme.css` (light value of every token it overrides). It makes `.theme-scope-light` stay light inside a dark page (widget preview, checkout). Regenerate it whenever `theme.css` changes. `theme="dark"` just uses the `.dark` class; `"auto"` adds neither.
- The checkout uses a `RadioGroup` grid for "Pay with", not BoardUI `Select`: popovers are portaled to `<body>` and escape the local theme scope and accent. Keep portaled components out of themed subtrees. (The dashboard `AssetSelect` is a Select and is fine because it is not themed.)
- Dates format in UTC (`lib/format.ts`, `lib/metrics.ts`) so SSR and hydration agree. Do not use local-time formatting for rendered dates.
- `cacheComponents: true` is on in `next.config.ts`: reading dynamic params (`params` in `/pay/[id]`) must happen under `<Suspense>`. See `app/pay/[id]/page.tsx`. `HostedCheckout` also snapshots `Date.now()` in `useState` to evaluate link expiry without hydration mismatch.
- Dashboard layout: `<main>` is the `@container`, and `Bento` is a 12-column grid. Spans use container queries (`@5xl:col-span-8`), not viewport breakpoints, because the sidebar changes the room available.
- A grid with no explicit columns has an implicit auto track that grows to its content and can overflow at phone width. Use `grid-cols-1` before `@xl:grid-cols-2`.
- Do not render two layouts and toggle them with CSS when they contain `TokenMark`. Token icons define SVG gradients by id, and an id that resolves inside a `display:none` subtree paints nothing. `PaymentsView` mounts the table or the list, never both.
- Every dashboard `page.tsx` exports `instant = false` because `DashboardShell` deliberately withholds pages until the store restores. It must be on the page; on the layout it has no effect here. New dashboard pages need it too. Without it, dev logs "Could not validate that a segment in your UI has instant navigation" on every dashboard route.
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
- `.dark` on a subtree works for tokens, and `.note` and `.foot` rely on it, but in a light page they still inherit `.site`'s light overrides, because `.dark .site` only matches a dark `<html>`. Anything `.site` sets (`--color-text-secondary`, `--color-border-focus-ring`) must be restated on `.foot`. Landing secondary text is stepped up in `.site`: BoardUI's neutral is 3.6 to 4.4:1 on these green grounds.
- Do not use `translate`, `transform` or reveal animations in the hero's machine; that rule is only relaxed below the hero, where nothing is measured. `Bus` is a straight stretched SVG and does not measure.
- `button-key` is named without the `bg-` prefix on purpose: `tailwind-merge` treats `bg-*` as a colour group and would drop the surface class beside it.
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
| Refunds | "Mark refunded" only changes status. No funds move. A refund after a payout can take an asset below zero; `ledger().shortfall` reports it and Payouts says so under the balance. |
| Payouts | Fake. No settlement account, no transfer, no wallet. Balances are derived from local records, timers stand in for routing, and references are `sim_` strings, never hashes. Scheduled runs never fire: the demo clock is frozen, so "next payout" is a date and an estimate. Stamped Simulated in the top bar, on the page, in the dialog, on the drawer, and `simulated=true` on every CSV row. Fees are a mock 0.3% swap plus $0.40. |
| Payout destinations | Format-checked only. Nothing is verified or contacted. |
| Command palette | Real, over local data. |
| Widget logo, email field | Logo is a local data URL under 80 KB. The email field collects nothing and sends nothing. |
| Route fees | Derived: what the customer paid above the price, from the mock 0.3% spread. |
| Webhooks, team, email alerts (Settings) | Saved locally. Nothing is sent, invited or delivered. |
| Branding | Accent is the default for new widgets. Support email and statement name are stored and used nowhere else. The hosted checkout does not read branding. |
| API keys (Settings) | Display only; nothing authenticates with them. |
| `/widget.js` and `@gateway/react` in the embed snippet | Do not exist. Strings only (`lib/embed.ts`). |
| `FlowChannels` | Decorative. It reflects the fake checkout timeline; no real route or solver data. |
| `Products` | The copy link, QR, email link and widget controls work. The note's merchant, deposit and serial are the seeded demo link. `lumen.studio/print`, the display domains and the embed snippet are fictional. The note is stamped SPECIMEN and the console and footer state that payments are simulated. |
| `Bus` and the header progress line | Decorative. The channel down the page carries nothing; its fill is scroll position. |
| Trust figures in `lib/site.ts` ("25+ chains", "~30s") | Placeholders. "~30s" is a design goal. Seeded `settleSeconds` is random 18 to 41. |
| "Non-custodial" copy | Describes the intended product, not this mock. |
| The name "Gateway" and merchant "Lumen Studio" | Working name and demo merchant. |

## Current status / next up

- Verification: `npx tsc --noEmit` and `npm run build` pass. Dashboard flows are covered by a throwaway Playwright script, not committed. `npm run lint` reports 5 errors and 2 warnings, all in vendored BoardUI files (`components/application/dashboard/dashboard-user-menu.tsx`, `components/application/data-table/data-table.tsx`, `components/application/settings/plan-art-flame.tsx`, `components/application/settings/settings-modal.tsx`, `components/base/date-picker/date-picker.tsx`, `components/base/date-picker/shared.tsx`); files we own are clean. There is no test suite; flows were checked with a throwaway Playwright script that is not committed.
- Git: `origin` is github.com/obsrvgmi/gateway (public), default branch `main`. The repo description and topics are set on GitHub. README images live in `.github/assets/`; the social preview there must be uploaded by hand in repo settings. No licence is specified yet.
- Done: landing (redesigned: note, console, docked header, footer), dashboard redesign (rail, top bar, palette, position strip, payouts, builder options, link editing), link creation/share/pay, widget customization and embed snippet (UI only), payments table, overview metrics, settings, demo-data reset.
- Not built: notification centre, keyboard shortcuts beyond the palette, link and widget detail pages, a stepped creation flow, a collapsible rail, tax or statement exports.
- Known gap: `useUnsavedGuard` can't stop the browser's Back button. Playwright's WebKit build segfaults on this Mac, so Safari was checked through a `WKWebView` harness (system WebKit): load, render, scroll timelines. Interactive flows have not been run in Safari.
- Next (nothing started): a real embeddable widget bundle, a backend for links and payments, auth, real NEAR Intents quoting and settlement.

## Working in parallel

- Claim work in small, short-lived branches; keep PRs focused.
- Do not both reformat vendored BoardUI files (`components/base|application|foundations`, `styles/theme.css`, `utils`, `hooks`). Add via the CLI; edit only when needed and keep diffs minimal.
- `lib/types.ts` and `lib/store.ts` are the merge hot spots (data model and every action). Announce changes to them and land them first and small.
- Seed data in `lib/seed.ts` changes alter every chart; call it out in the PR.
