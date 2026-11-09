import { ASSET_SYMBOLS, RECEIVE_ASSETS } from "@/lib/assets";

/**
 * The public REST API, as OpenAPI 3.1. Served at `/api/v1/openapi.json`, and the docs page's reference
 * is drawn from it, so the two can't disagree. Shared, because the docs page renders in the browser too. `test/developers.test.ts` fails if a v1 route or method
 * is missing here, or documented here but missing from `app/api/v1`.
 */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const id = (prefix: string, example: string) => ({ type: "string", pattern: `^${prefix}_[a-z0-9]+$`, examples: [example] });
const error = (description: string) => ({ description, content: { "application/json": { schema: ref("Error") } } });
const ok = (description: string, schema: object, status = "200") => ({ [status]: { description, content: { "application/json": { schema } } } });
const list = (item: string, extra: Record<string, object> = {}) => ({ type: "object", required: ["data"], properties: { data: { type: "array", items: ref(item) }, ...extra } });

const COMMON_ERRORS = { "401": error("No key, or a key that isn't valid or was revoked."), "429": error("More than 600 requests a minute for this key.") };
const PATH_ID = (prefix: string, example: string) => ({ name: "id", in: "path", required: true, schema: id(prefix, example) });

const metadata = {
  type: "object",
  description: "Your own keys and values, such as an order id. Up to 20 keys of 1 to 40 letters, digits, dots, dashes or underscores; values are strings of up to 500 characters. Copied onto each payment and into its webhooks. Never shown to the customer.",
  maxProperties: 20,
  propertyNames: { pattern: "^[A-Za-z0-9_.-]{1,40}$" },
  additionalProperties: { type: "string", maxLength: 500 },
  examples: [{ order_id: "1234" }],
};

const linkWritable = {
  title: { type: "string", minLength: 1, maxLength: 200, description: "Shown to the customer at checkout." },
  description: { type: "string", maxLength: 1000 },
  amount: { type: ["number", "null"], exclusiveMinimum: 0, description: "In USD, at most two decimals. Null lets the customer enter the amount." },
  receiveAsset: { type: "string", enum: RECEIVE_ASSETS.map((asset) => asset.symbol), description: "What you receive, whatever the customer pays with." },
  status: { type: "string", enum: ["active", "paused", "expired"] },
  expiresAt: { type: ["string", "null"], format: "date-time" },
  successUrl: { type: "string", description: "http or https. After paying, the customer is offered a way back here, with `payment_id` and `source_id` added to the query. Look the payment up before trusting it." },
  metadata,
  singleUse: { type: "boolean", description: "Close the link once a payment for it has money arriving. Default false." },
  publicStats: { type: "boolean", description: "Let anyone read this link's settled total and count, for a counter on your site. Default false." },
};

const money = (description: string) => ({
  type: "object",
  description,
  required: ["asset", "chain", "amount_base", "decimals"],
  properties: {
    asset: { type: "string", enum: ASSET_SYMBOLS },
    chain: { type: "string", examples: ["Base"] },
    amount_base: { type: ["string", "null"], pattern: "^[0-9]+$", description: "An integer in the asset's smallest unit. Read it as a big integer, never a float." },
    decimals: { type: "integer" },
  },
});

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Gateway API",
    version: "1.0.0",
    description: "Take crypto payments in any supported asset and receive the one you chose, without Gateway holding funds. A key reads payments and manages payment links. It can never move money: payouts and refunds need your wallet's signature, in the dashboard.",
  },
  servers: [{ url: "https://YOUR-GATEWAY" }],
  security: [{ bearer: [] }],
  paths: {
    "/api/v1/payment-links": {
      get: {
        operationId: "listPaymentLinks",
        summary: "List payment links",
        description: "The newest 200 links that haven't been deleted.",
        responses: { ...ok("Links, newest first.", list("PaymentLink")), ...COMMON_ERRORS },
      },
      post: {
        operationId: "createPaymentLink",
        summary: "Create a payment link",
        description: "Send an `Idempotency-Key` so a retried request can't create two links. The same key with a different body is refused with `idempotency_mismatch`.",
        parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 200 }, description: "Your own unique value for this request, such as your order id." }],
        requestBody: { required: true, content: { "application/json": { schema: ref("PaymentLinkCreate") } } },
        responses: { ...ok("The new link, with its `url`. A replay returns the first response with `Idempotent-Replay: true`.", ref("PaymentLink"), "201"), "400": error("A field is missing or invalid."), "409": error("The Idempotency-Key was used with a different request, or that request is still running."), ...COMMON_ERRORS },
      },
    },
    "/api/v1/payment-links/{id}": {
      parameters: [PATH_ID("lnk", "lnk_8fk2m1")],
      get: { operationId: "getPaymentLink", summary: "Read a payment link", responses: { ...ok("The link.", ref("PaymentLink")), "404": error("No such link in this workspace."), ...COMMON_ERRORS } },
      patch: {
        operationId: "updatePaymentLink",
        summary: "Change a payment link",
        description: "Only the fields you send change. Payments already made keep the metadata they started with.",
        requestBody: { required: true, content: { "application/json": { schema: ref("PaymentLinkPatch") } } },
        responses: { ...ok("The link as it is now.", ref("PaymentLink")), "400": error("A field is invalid."), "404": error("No such link in this workspace."), ...COMMON_ERRORS },
      },
      delete: { operationId: "deletePaymentLink", summary: "Delete a payment link", description: "Its page stops working. Payments made through it are kept.", responses: { ...ok("Deleted.", { type: "object", properties: { ok: { const: true } } }), "404": error("No such link in this workspace."), ...COMMON_ERRORS } },
    },
    "/api/v1/payments": {
      get: {
        operationId: "listPayments",
        summary: "List payments",
        description: "Newest first. Addresses issued but never paid aren't payments and aren't listed. When `has_more` is true, pass the last payment's id as `starting_after`.",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
          { name: "starting_after", in: "query", schema: id("pay", "pay_3kq9z"), description: "The last payment id of the previous page." },
          { name: "link", in: "query", schema: { type: "string", pattern: "^(lnk|wgt)_[a-z0-9]+$" }, description: "Only payments made through this link or widget." },
          { name: "status", in: "query", schema: { type: "string", enum: ["processing", "settled", "refunded", "expired", "failed"] } },
          { name: "before", in: "query", schema: { type: "string", format: "date-time" }, description: "Only payments created before this time." },
        ],
        responses: { ...ok("A page of payments.", list("Payment", { has_more: { type: "boolean" } })), "400": error("A query parameter is invalid."), ...COMMON_ERRORS },
      },
    },
    "/api/v1/payments/{id}": {
      parameters: [PATH_ID("pay", "pay_3kq9z")],
      get: { operationId: "getPayment", summary: "Read a payment", description: "Use this to confirm a payment before fulfilling an order, rather than trusting a redirect or a browser event.", responses: { ...ok("The payment.", ref("Payment")), "404": error("No such payment in this workspace."), ...COMMON_ERRORS } },
    },
    "/api/v1/payouts": {
      get: { operationId: "listPayouts", summary: "List payouts", description: "Read only. Moving money needs your wallet's signature in the dashboard, which a key can never stand in for.", responses: { ...ok("The newest 200 payouts.", list("Payout")), ...COMMON_ERRORS } },
    },
    "/api/v1/stats": {
      get: {
        operationId: "getStats",
        summary: "Totals for a window",
        description: "The dashboard's figures, computed in the database, for the current mode only. Success rate leaves in-flight payments out.",
        parameters: [
          { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "until", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "link", in: "query", schema: { type: "string", pattern: "^(lnk|wgt)_[a-z0-9]+$" } },
        ],
        responses: { ...ok("Totals.", ref("Stats")), "400": error("A query parameter is invalid."), ...COMMON_ERRORS },
      },
    },
  },
  webhooks: Object.fromEntries(
    ["payment.processing", "payment.settled", "payment.refunded", "payment.expired", "payment.failed", "payment.underpaid", "payout.sent", "payout.failed", "link.created"].map((type) => [
      type,
      {
        post: {
          summary: type,
          description: "Signed with your endpoint's secret: `Gateway-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of t + \".\" + raw body>`. Return any 2xx. Retried with growing gaps for over a day.",
          parameters: [
            { name: "Gateway-Event", in: "header", required: true, schema: { const: type } },
            { name: "Gateway-Event-Id", in: "header", required: true, schema: id("evt", "evt_123") },
            { name: "Gateway-Signature", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { content: { "application/json": { schema: ref("Event") } } },
          responses: { "2XX": { description: "Received." } },
        },
      },
    ]),
  ),
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Your API key, `gw_live_…` or `gw_test_…`, from Settings, Developers." } },
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", examples: ["invalid_input"] }, message: { type: "string" }, issues: { type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } } } } },
      },
      PaymentLinkCreate: { type: "object", required: ["title", "amount", "receiveAsset"], properties: linkWritable, additionalProperties: false },
      PaymentLinkPatch: { type: "object", properties: linkWritable, additionalProperties: false },
      PaymentLink: {
        type: "object",
        required: ["id", "url", "title", "description", "amount", "receiveAsset", "status", "expiresAt", "successUrl", "metadata", "singleUse", "publicStats", "createdAt"],
        properties: { id: id("lnk", "lnk_8fk2m1"), url: { type: "string", format: "uri", description: "Send the customer here." }, ...linkWritable, createdAt: { type: "string", format: "date-time" } },
      },
      Payment: {
        type: "object",
        required: ["id", "status", "state", "live", "source", "amount_usd", "pay", "receive", "metadata", "created_at"],
        properties: {
          id: id("pay", "pay_3kq9z"),
          status: { type: "string", enum: ["processing", "settled", "refunded", "expired", "failed"], description: "Fulfil on `settled`. `expired` isn't final: money that arrives late can still settle." },
          state: { type: "string", description: "The finer state behind `status`, such as `deposit_seen` or `underpaid`. New values may be added." },
          live: { type: "boolean", description: "False for test-mode payments. Never fulfil a real order from one." },
          source: { type: "object", properties: { type: { enum: ["link", "widget"] }, id: { type: "string" }, name: { type: "string" } } },
          amount_usd: { type: "number", description: "The price in USD. Use `receive.amount_base` for what you got." },
          pay: money("What the customer sent."),
          receive: money("What you receive. `amount_base` is what arrived once settled, and what was quoted before."),
          payer: { type: "string", description: "The customer's wallet, where a route refund returns." },
          customer_email: { type: ["string", "null"] },
          metadata,
          origin_tx_hashes: { type: "array", items: { type: "string" } },
          destination_tx_hashes: { type: "array", items: { type: "string" } },
          created_at: { type: "string", format: "date-time" },
          settled_at: { type: ["string", "null"], format: "date-time" },
        },
      },
      Payout: {
        type: "object",
        properties: {
          id: id("pyt", "pyt_7d2k"),
          asset: { type: "string" },
          amount: { type: "number" },
          receiveAsset: { type: "string" },
          receiveAmount: { type: "number" },
          usd: { type: "number" },
          feeUsd: { type: "number" },
          destinationLabel: { type: "string" },
          destinationAddress: { type: "string" },
          status: { type: "string", enum: ["processing", "sent", "failed"] },
          trigger: { type: "string" },
          paymentCount: { type: "integer" },
          reference: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          completedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
      Stats: {
        type: "object",
        required: ["live", "currency", "volume_usd", "payments", "success_rate", "by_pay_asset"],
        properties: {
          live: { type: "boolean" },
          since: { type: ["string", "null"], format: "date-time" },
          until: { type: ["string", "null"], format: "date-time" },
          currency: { const: "USD" },
          volume_usd: { type: "number", description: "Settled payments only." },
          payments: { type: "object", properties: Object.fromEntries(["total", "settled", "processing", "refunded", "failed", "expired"].map((key) => [key, { type: "integer" }])) },
          success_rate: { type: ["number", "null"], description: "Settled over payments with an outcome. Null when none has one yet." },
          by_pay_asset: { type: "array", items: { type: "object", properties: { asset: { type: "string" }, volume_usd: { type: "number" }, payments: { type: "integer" } } } },
        },
      },
      Event: {
        type: "object",
        required: ["id", "type", "created_at", "data"],
        properties: { id: id("evt", "evt_123"), type: { type: "string" }, created_at: { type: "string", format: "date-time" }, data: { description: "A Payment for `payment.*` (with `refund` on `payment.refunded`), a Payout for `payout.*`, a link summary for `link.created`." } },
      },
    },
  },
} as const;

export function openapiFor(origin: string) {
  return { ...OPENAPI, servers: [{ url: origin, description: "This Gateway" }] };
}
