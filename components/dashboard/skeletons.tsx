import { Skeleton } from "@/components/base/skeleton/skeleton";

/** Shown only until saved state is restored, and only if that takes long enough to notice. */
export function PageSkeleton() {
  return (
    <div className="dash-skeleton flex flex-col gap-4" role="status" aria-label="Loading dashboard">
      <div className="flex flex-col gap-2">
        <Skeleton shape="text" className="h-9 w-56" />
        <Skeleton shape="text" className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Skeleton className="col-span-12 h-96 rounded-3xl @5xl:col-span-8" />
        <Skeleton className="col-span-12 h-96 rounded-3xl @5xl:col-span-4" />
        {[0, 1, 2, 3].map((key) => <Skeleton key={key} className="col-span-6 h-32 rounded-3xl @5xl:col-span-3" />)}
      </div>
    </div>
  );
}
