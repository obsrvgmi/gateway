import type { Widget } from "./types";

type EmbedOptions = Partial<Pick<Widget, "accent" | "radius" | "theme" | "receiveAsset" | "amount" | "acceptedAssets" | "presets" | "buttonLabel" | "displayName" | "collectEmail" | "success">>;

/**
 * Only the id goes in the snippet. The widget's look and rules are read from the server when it loads,
 * so saving a change in the builder updates every page it's embedded on, and a merchant's page can't
 * override what it accepts or what it charges.
 */
export function embedSnippet(origin: string, widgetId: string, kind: "html" | "react", _options: EmbedOptions = {}) {
  void _options;
  if (kind === "react") return `import { GatewayWidget } from "@gateway/react";\n\n<GatewayWidget id="${widgetId}" />`;
  return `<script src="${origin}/widget.js" data-widget="${widgetId}" async></script>`;
}
