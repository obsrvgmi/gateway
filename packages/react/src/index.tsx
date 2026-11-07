import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface GatewayWidgetProps {
  /** The widget's id, from your dashboard. */
  id: string;
  /** Where your Gateway runs, such as `https://pay.example.com`. */
  baseUrl: string;
  /**
   * The customer's browser says a payment settled. For your interface only: it runs on their machine,
   * so never fulfil an order from it. Use a signed webhook.
   */
  onSettled?: (paymentId: string) => void;
  onStateChange?: (state: { paymentId: string; state: string; status: string }) => void;
  className?: string;
  style?: CSSProperties;
}

interface GatewayMessage {
  source?: string;
  type?: string;
  height?: number;
  paymentId?: string;
  state?: string;
  status?: string;
}

/** The checkout in an iframe, the same as `/widget.js`. Its look and rules come from your dashboard. */
export function GatewayWidget({ id, baseUrl, onSettled, onStateChange, className, style }: GatewayWidgetProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(620);
  const origin = new URL(baseUrl).origin;

  useEffect(() => {
    const onMessage = (event: MessageEvent<GatewayMessage>) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data;
      if (data?.source !== "gateway") return;
      if (data.type === "resize" && typeof data.height === "number") setHeight(Math.max(200, Math.min(data.height + 8, 1400)));
      if (data.type === "payment.settled" && data.paymentId) onSettled?.(data.paymentId);
      if (data.type === "payment.state" && data.paymentId) onStateChange?.({ paymentId: data.paymentId, state: data.state ?? "", status: data.status ?? "" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [origin, onSettled, onStateChange]);

  return <iframe ref={frame} src={`${origin}/embed/${encodeURIComponent(id)}`} title="Checkout" allow="clipboard-write" className={className} style={{ width: "100%", maxWidth: 420, height, border: 0, background: "transparent", display: "block", ...style }} />;
}
