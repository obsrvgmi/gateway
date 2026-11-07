/*
 * Gateway checkout loader.
 *
 *   <script src="https://YOUR-GATEWAY/widget.js" data-widget="wgt_..." async></script>
 *
 * Puts the checkout in an iframe where this tag sits. Your page never touches the customer's wallet,
 * and the widget's settings come from your dashboard. It raises events on the iframe's parent:
 *
 *   element.addEventListener("gateway:settled", (event) => console.log(event.detail.paymentId));
 *
 * Don't fulfil an order from this event, which runs in the customer's browser. Use a signed webhook.
 */
(function () {
  var script = document.currentScript;
  if (!script) return;
  var id = script.getAttribute("data-widget");
  if (!id || !/^wgt_[a-z0-9]+$/.test(id)) {
    console.error("Gateway: data-widget is missing or invalid.");
    return;
  }
  var origin = new URL(script.src).origin;
  var frame = document.createElement("iframe");
  frame.src = origin + "/embed/" + id;
  frame.title = "Checkout";
  frame.setAttribute("allow", "clipboard-write");
  frame.style.cssText = "width:100%;max-width:420px;height:620px;border:0;background:transparent;display:block";
  var host = script.parentNode;
  host.insertBefore(frame, script);

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || event.source !== frame.contentWindow) return;
    var data = event.data;
    if (!data || data.source !== "gateway") return;
    if (data.type === "resize" && typeof data.height === "number") {
      frame.style.height = Math.max(200, Math.min(data.height + 8, 1400)) + "px";
      return;
    }
    var name = data.type === "payment.settled" ? "gateway:settled" : data.type === "payment.state" ? "gateway:state" : null;
    if (name) host.dispatchEvent(new CustomEvent(name, { bubbles: true, detail: { paymentId: data.paymentId, state: data.state, status: data.status } }));
  });
})();
