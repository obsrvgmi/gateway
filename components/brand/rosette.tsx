import { cx } from "@/utils/cx";

const round = (value: number) => Number(value.toFixed(2));

/** One closed guilloche ring: a circle carrying a petal wave, sampled to a polyline. */
function ring(radius: number, depth: number, petals: number, phase: number) {
  const points: string[] = [];
  const steps = petals * 14;
  for (let index = 0; index <= steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const r = radius + depth * Math.sin(petals * angle + phase);
    points.push(`${round(50 + r * Math.cos(angle))} ${round(50 + r * Math.sin(angle))}`);
  }
  return `M${points.join("L")}Z`;
}

/** Banknote-style seal. Pure and rounded, so server and client paths match exactly. */
export function Rosette({ className, petals = 24, rings = 11, inner = 21, outer = 39, strokeWidth = 0.28 }: { className?: string; petals?: number; rings?: number; inner?: number; outer?: number; strokeWidth?: number }) {
  const depth = (outer - inner) / 2;
  const middle = (outer + inner) / 2;
  const paths = Array.from({ length: rings }, (_, index) => ring(middle, depth, petals, (index / rings) * Math.PI * 2));
  return (
    <svg viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth={strokeWidth} aria-hidden className={cx("size-full", className)}>
      {paths.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
