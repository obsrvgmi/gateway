import type { Widget } from "./types";

type EmbedOptions = Partial<Pick<Widget, "accent" | "radius" | "theme" | "receiveAsset" | "amount" | "acceptedAssets" | "presets" | "buttonLabel" | "displayName" | "collectEmail" | "success">>;

/** Anything left at its default is omitted, so the snippet only says what this widget changes. */
function attributes({ accent, radius, theme, receiveAsset, amount, acceptedAssets, presets, buttonLabel, displayName, collectEmail, success }: EmbedOptions) {
  const entries: [string, string][] = [];
  if (theme && theme !== "auto") entries.push(["theme", theme]);
  if (accent) entries.push(["accent", accent]);
  if (radius && radius !== "rounded") entries.push(["corners", radius]);
  if (receiveAsset) entries.push(["receive", receiveAsset]);
  if (amount) entries.push(["amount", String(amount)]);
  if (acceptedAssets && acceptedAssets.length < 8) entries.push(["assets", acceptedAssets.join(",")]);
  if (presets?.length) entries.push(["presets", presets.join(",")]);
  if (buttonLabel) entries.push(["button", buttonLabel]);
  if (displayName) entries.push(["merchant", displayName]);
  if (collectEmail) entries.push(["collect-email", "true"]);
  if (success && success.mode !== "receipt") entries.push(["on-success", success.mode === "redirect" ? success.url : "message"]);
  return entries;
}

const camel = (key: string) => key.replace(/-(.)/g, (_, letter: string) => letter.toUpperCase());

/** The script URL is a mock: no widget bundle ships with this frontend yet. */
export function embedSnippet(origin: string, widgetId: string, kind: "html" | "react", options: EmbedOptions = {}) {
  const pairs = attributes(options);
  if (kind === "react") {
    const props = pairs.map(([key, value]) => `\n  ${camel(key)}="${value}"`).join("");
    return `import { GatewayWidget } from "@gateway/react";\n\n<GatewayWidget${pairs.length ? `\n  id="${widgetId}"${props}\n` : ` id="${widgetId}" `}/>`;
  }
  if (pairs.length === 0) return `<script src="${origin}/widget.js" data-widget="${widgetId}" async></script>`;
  return `<script\n  src="${origin}/widget.js"\n  data-widget="${widgetId}"${pairs.map(([key, value]) => `\n  data-${key}="${value}"`).join("")}\n  async></script>`;
}
