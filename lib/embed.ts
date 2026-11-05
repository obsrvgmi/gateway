/** The script URL is a mock: no widget bundle ships with this frontend yet. */
export function embedSnippet(origin: string, widgetId: string, kind: "html" | "react") {
  if (kind === "react") {
    return `import { GatewayWidget } from "@gateway/react";\n\n<GatewayWidget id="${widgetId}" />`;
  }
  return `<script src="${origin}/widget.js" data-widget="${widgetId}" async></script>`;
}
