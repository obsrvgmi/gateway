import type { ComponentType, SVGProps } from "react";
import NetworkBase from "@web3icons/react/icons/networks/NetworkBase";
import NetworkTron from "@web3icons/react/icons/networks/NetworkTron";
import TokenARB from "@web3icons/react/icons/tokens/TokenARB";
import TokenBNB from "@web3icons/react/icons/tokens/TokenBNB";
import TokenBTC from "@web3icons/react/icons/tokens/TokenBTC";
import TokenETH from "@web3icons/react/icons/tokens/TokenETH";
import TokenNEAR from "@web3icons/react/icons/tokens/TokenNEAR";
import TokenSOL from "@web3icons/react/icons/tokens/TokenSOL";
import TokenUSDC from "@web3icons/react/icons/tokens/TokenUSDC";
import TokenUSDT from "@web3icons/react/icons/tokens/TokenUSDT";
import type { AssetSymbol } from "@/lib/types";
import { cx } from "@/utils/cx";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { variant?: "branded" | "mono" | "background"; size?: number }>;

// Per-icon imports: the package root would pull every logo into the bundle.
const MARKS: Record<AssetSymbol, Icon> = {
  ETH: TokenETH as Icon,
  BTC: TokenBTC as Icon,
  SOL: TokenSOL as Icon,
  NEAR: TokenNEAR as Icon,
  USDT: TokenUSDT as Icon,
  USDC: TokenUSDC as Icon,
  BNB: TokenBNB as Icon,
  ARB: TokenARB as Icon,
};

/** Assets whose chain is not implied by the mark get a network badge. */
const CHAIN_BADGE: Partial<Record<AssetSymbol, { mark: Icon; ground: string }>> = {
  USDC: { mark: NetworkBase as Icon, ground: "#0000ff" },
  USDT: { mark: NetworkTron as Icon, ground: "#c4342b" },
};

const SIZES = { xs: "size-5", sm: "size-6", md: "size-8", lg: "size-10", xl: "size-12" };

export function TokenMark({ symbol, size = "md", showChain = false, className }: { symbol: AssetSymbol; size?: keyof typeof SIZES; showChain?: boolean; className?: string }) {
  const Mark = MARKS[symbol];
  // Below 32px a badge is noise, so small marks drop it and the chain goes in text.
  const badge = showChain && (size === "md" || size === "lg" || size === "xl") ? CHAIN_BADGE[symbol] : undefined;
  return (
    <span aria-hidden className={cx("relative inline-flex shrink-0", SIZES[size], className)}>
      {/* The icons share clip-path ids across the document, and a reference to a hidden copy blanks the logo. The clip is only the 24 unit square, so it is removed. */}
      <Mark variant="background" className="size-full rounded-full [&_g]:[clip-path:none]" />
      {badge && (
        <span style={{ background: badge.ground }} className="absolute -end-0.5 -bottom-0.5 flex size-[40%] items-center justify-center rounded-full text-white ring-2 ring-background-primary-default">
          <badge.mark variant="mono" className="size-[62%] [&_g]:[clip-path:none]" />
        </span>
      )}
    </span>
  );
}
