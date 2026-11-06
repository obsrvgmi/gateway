import { SITE } from "@/lib/site";
import { cx } from "@/utils/cx";

/**
 * A G drawn as three fine lines closing into one bar: every asset in, one out.
 * Uses currentColor so it sits on any ground. Drawn on the 32 unit grid that app/icon.svg shares.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeLinecap="round" aria-hidden className={cx("size-7", className)}>
      <path strokeWidth="2.6" d="M27.2 10.6A13 13 0 1 0 29 16H16" />
      <path strokeWidth="1.5" opacity=".62" d="M22.7 12.8A8.4 8.4 0 1 0 24.4 19" />
      <path strokeWidth="1.5" opacity=".36" d="M18.4 12.9A4.4 4.4 0 1 0 20 19" />
    </svg>
  );
}

export function Logo({ className, showName = true }: { className?: string; showName?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-2 text-text-primary", className)}>
      <span className="logo-key flex size-7 items-center justify-center rounded-lg text-text-on-accent">
        <LogoMark className="size-5" />
      </span>
      {showName && <span className="logo-name text-headline-semibold tracking-[-0.015em]">{SITE.name}</span>}
    </span>
  );
}
