import { cx } from "@/utils/cx";
import { Channel } from "./flow-channels";

/**
 * The hero's output channel, carried on down the page's axis. A straight run stretched to its box:
 * only the height scales, so the groove's stroke widths stay true. `span` is the rough drawn
 * length in px; it keeps the pulse's round cap from visibly stretching.
 */
export function Bus({ span, delay = 0, className }: { span: number; delay?: number; className?: string }) {
  return (
    <span aria-hidden className={cx("bus", className)}>
      <svg viewBox={`0 0 14 ${span}`} preserveAspectRatio="none" data-state="idle" className="flow-channels">
        <Channel d={`M7 0V${span}`} delay={delay} className="is-output" />
      </svg>
    </span>
  );
}
