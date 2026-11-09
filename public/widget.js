/*
 * Gateway for the browser. One script, served by your Gateway:
 *
 *   <script src="https://YOUR-GATEWAY/widget.js" async></script>
 *
 * 1. An embedded checkout where the tag sits:      <script src=".../widget.js" data-widget="wgt_..." async></script>
 * 2. The same from code, for single-page apps:     Gateway.mount(element, { widget: "wgt_...", onSettled })
 * 3. Hosted checkout for an order, in a popup:     Gateway.checkout({ link: "lnk_..." , onSettled }).then(...)
 *    `link` may be an id, its url, or a promise of either, so your server can create the link on click.
 * 4. A public counter, once you turn on public totals for that link or widget:
 *      <span data-gateway-stats="lnk_..." data-show="raised"></span>      ("raised", "payments" or "both")
 *      Gateway.stats("lnk_...").then(({ raised_usd, payments }) => ...)
 *
 * Browser events run on the customer's machine, so they're for your interface only. Fulfil an order from a
 * signed webhook, or after reading the payment with your API key.
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.src) return;
  var origin = new URL(script.src).origin;
  var ID = /^(lnk|wgt)_[a-z0-9]+$/;

  function fromGateway(event, frame) {
    var data = event.data;
    return event.origin === origin && event.source === frame && data && data.source === "gateway" ? data : null;
  }

  /** What a message says, filling gaps from what was already known, so a later message can't blank it. */
  function detail(data, known) {
    known = known || {};
    return {
      paymentId: data.paymentId || known.paymentId || null,
      state: data.state || known.state || null,
      status: data.status || (data.type === "payment.settled" ? "settled" : known.status || null),
    };
  }

  /** Puts the checkout in an iframe inside `host`. Your page never touches the customer's wallet. */
  function mount(host, options) {
    var id = options && options.widget;
    if (!host || !id || !ID.test(id)) throw new Error("Gateway.mount needs an element and a widget id (wgt_...).");
    var frame = document.createElement("iframe");
    frame.src = origin + "/embed/" + id;
    frame.title = "Checkout";
    frame.setAttribute("allow", "clipboard-write");
    frame.style.cssText = "width:100%;max-width:420px;height:620px;border:0;background:transparent;display:block";
    host.appendChild(frame);
    function onMessage(event) {
      var data = fromGateway(event, frame.contentWindow);
      if (!data) return;
      if (data.type === "resize" && typeof data.height === "number") {
        frame.style.height = Math.max(200, Math.min(data.height + 8, 1400)) + "px";
        return;
      }
      var name = data.type === "payment.settled" ? "gateway:settled" : data.type === "payment.state" ? "gateway:state" : null;
      if (!name) return;
      host.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: detail(data) }));
      if (name === "gateway:settled" && options.onSettled) options.onSettled(detail(data));
      if (name === "gateway:state" && options.onState) options.onState(detail(data));
    }
    window.addEventListener("message", onMessage);
    return {
      frame: frame,
      destroy: function () {
        window.removeEventListener("message", onMessage);
        frame.remove();
      },
    };
  }

  function linkUrl(link) {
    if (typeof link !== "string") throw new Error("Gateway.checkout: link must be a link id or its url.");
    if (ID.test(link)) return origin + "/pay/" + link;
    var url = new URL(link, origin);
    // Only this Gateway's own checkout, so a mistake can't send customers somewhere else.
    if (url.origin !== origin || !/^\/pay\/lnk_[a-z0-9]+$/.test(url.pathname)) throw new Error("Gateway.checkout: that isn't a payment link from " + origin + ".");
    return url.toString();
  }

  /**
   * Opens hosted checkout in a popup. Call it straight from a click handler, or the browser blocks the
   * popup. If it's blocked anyway, the page goes to checkout instead, and your success URL brings the
   * customer back. Resolves when the popup closes, with the last thing it said.
   */
  function checkout(options) {
    options = options || {};
    var width = 460;
    var height = 760;
    var left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || width) - width) / 2);
    var top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || height) - height) / 2);
    var popup = window.open("", "gateway-checkout", "popup,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top);
    if (popup) {
      try {
        popup.document.title = "Checkout";
        popup.document.body.style.cssText = "font:14px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#555";
        popup.document.body.textContent = "Opening checkout…";
      } catch {
        // A popup left on another page from an earlier checkout: it's navigated below all the same.
      }
    }
    var last = { paymentId: null, state: null, status: null };
    return Promise.resolve(typeof options.link === "function" ? options.link() : options.link)
      .then(function (link) {
        var url = linkUrl(link && typeof link === "object" ? link.url || link.id : link);
        if (!popup || popup.closed) {
          window.location.assign(url);
          return new Promise(function () {});
        }
        popup.location.href = url;
        if (popup.focus) popup.focus();
        return new Promise(function (resolve) {
          function onMessage(event) {
            var data = fromGateway(event, popup);
            if (!data) return;
            last = detail(data, last);
            if (data.type === "payment.state" && options.onState) options.onState(last);
            if (data.type === "payment.settled" && options.onSettled) options.onSettled(last);
          }
          window.addEventListener("message", onMessage);
          var timer = window.setInterval(function () {
            if (!popup.closed) return;
            window.clearInterval(timer);
            window.removeEventListener("message", onMessage);
            if (options.onClose) options.onClose(last);
            resolve(last);
          }, 400);
        });
      })
      .catch(function (error) {
        if (popup && !popup.closed) popup.close();
        throw error;
      });
  }

  /** The public totals of a link or widget, if its merchant turned them on. Rejects otherwise. */
  function stats(id) {
    if (!ID.test(id || "")) return Promise.reject(new Error("Gateway.stats needs a link or widget id."));
    return fetch(origin + "/api/checkout/" + id + "/stats", { credentials: "omit" }).then(function (response) {
      if (!response.ok) throw new Error("Public totals aren't on for " + id + ".");
      return response.json();
    });
  }

  function usd(value) {
    var whole = Math.round(value * 100) % 100 === 0;
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(value);
  }
  function renderStats(element) {
    var id = element.getAttribute("data-gateway-stats");
    var show = element.getAttribute("data-show") || "both";
    stats(id).then(
      function (totals) {
        var raised = usd(totals.raised_usd);
        var count = totals.payments + (totals.payments === 1 ? " payment" : " payments");
        element.textContent = show === "raised" ? raised : show === "payments" ? count : raised + " from " + count;
      },
      function () {},
    );
  }
  function renderAllStats() {
    var nodes = document.querySelectorAll("[data-gateway-stats]");
    for (var i = 0; i < nodes.length; i++) renderStats(nodes[i]);
  }

  if (!window.Gateway) {
    window.Gateway = { origin: origin, mount: mount, checkout: checkout, stats: stats, refreshStats: renderAllStats };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderAllStats);
    else renderAllStats();
    window.setInterval(function () {
      if (!document.hidden) renderAllStats();
    }, 60000);
  }

  // The original form: a checkout where the tag sits.
  var widget = script.getAttribute("data-widget");
  if (widget) {
    if (!ID.test(widget) || widget.indexOf("wgt_") !== 0) {
      console.error("Gateway: data-widget is missing or invalid.");
      return;
    }
    var host = document.createElement("div");
    script.parentNode.insertBefore(host, script);
    mount(host, { widget: widget });
  }
})();
