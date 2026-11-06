"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/base/skeleton/skeleton";
import { CARD_SPANS } from "./ui";

const Header = () => (
  <div className="flex flex-col gap-1">
    <Skeleton shape="text" className="h-9 w-48" />
    <Skeleton shape="text" className="h-[1.125rem] w-72 max-w-full" />
  </div>
);

const Tile = ({ className = "" }: { className?: string }) => <Skeleton className={`col-span-6 h-[6.5rem] @5xl:col-span-3 ${className} rounded-3xl`} />;

function OverviewSkeleton() {
  return (
    <>
      <Header />
      <Skeleton className="h-[10.5rem] rounded-3xl @[56rem]:h-[6.5rem]" />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Skeleton className="col-span-12 h-[28rem] rounded-3xl @5xl:col-span-8 @ultra:col-span-6 @ultra:h-[34rem]" />
        <div className="contents @ultra:col-span-3 @ultra:grid @ultra:grid-cols-2 @ultra:content-start @ultra:gap-4">
          {[0, 1, 2, 3].map((key) => <Tile key={key} className="@ultra:col-span-1" />)}
        </div>
        <Skeleton className="col-span-12 row-start-2 h-[28rem] rounded-3xl @5xl:col-span-4 @5xl:row-start-1 @ultra:col-span-3 @ultra:h-[34rem]" />
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <>
      <Header />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <div className="contents @wide:col-span-3 @wide:col-start-10 @wide:row-start-1 @wide:grid @wide:grid-cols-2 @wide:content-start @wide:gap-4">
          {[0, 1, 2, 3].map((key) => <Tile key={key} className="@wide:col-span-1" />)}
        </div>
        <Skeleton className="col-span-12 h-[39rem] rounded-3xl @5xl:col-span-9 @wide:col-start-1 @wide:row-span-2 @wide:row-start-1" />
        <Skeleton className="col-span-12 h-64 rounded-3xl @5xl:col-span-3 @wide:col-start-10 @wide:row-start-2" />
      </div>
    </>
  );
}

function PayoutsSkeleton() {
  return (
    <>
      <Header />
      <Skeleton className="h-16 rounded-2xl" />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Skeleton className="col-span-12 h-80 rounded-3xl @5xl:col-span-7 @ultra:col-span-5" />
        <Skeleton className="col-span-12 h-80 rounded-3xl @5xl:col-span-5 @ultra:col-span-4" />
        <Skeleton className="hidden h-80 rounded-3xl @ultra:col-span-3 @ultra:block" />
        <Skeleton className="col-span-12 hidden h-[39rem] rounded-3xl @wide:col-span-8 @wide:row-span-3 @wide:block @ultra:row-span-2" />
        {[0, 1, 2].map((key) => <Skeleton key={key} className="col-span-12 h-52 rounded-3xl @2xl:col-span-6 @5xl:col-span-4" />)}
      </div>
    </>
  );
}

function CardsSkeleton() {
  return (
    <>
      <Header />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        {[0, 1, 2, 3].map((key) => <Tile key={key} />)}
      </div>
      <Skeleton className="h-10 rounded-xl" />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        {[0, 1, 2, 3, 4, 5].map((key) => <Skeleton key={key} className={`${CARD_SPANS} h-60 rounded-3xl`} />)}
      </div>
    </>
  );
}

function FormSkeleton() {
  return (
    <>
      <Header />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4 @wide:grid-cols-[minmax(0,46rem)_minmax(0,1fr)]">
        <Skeleton className="col-span-12 h-[39rem] rounded-3xl @4xl:col-span-7 @wide:col-span-1" />
        <Skeleton className="col-span-12 h-[28rem] rounded-3xl @4xl:col-span-5 @wide:col-span-1 @wide:h-[calc(100dvh-11.5rem)]" />
      </div>
    </>
  );
}

function SettingsSkeleton() {
  return (
    <>
      <Header />
      <Skeleton className="h-10 w-96 max-w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Skeleton className="col-span-12 h-[27rem] rounded-3xl @5xl:col-span-7" />
        <Skeleton className="col-span-12 h-[27rem] rounded-3xl @5xl:col-span-5" />
      </div>
    </>
  );
}

function forRoute(pathname: string) {
  if (pathname === "/dashboard") return <OverviewSkeleton />;
  if (pathname.endsWith("/new") || pathname.endsWith("/edit")) return <FormSkeleton />;
  if (pathname.startsWith("/dashboard/payments")) return <ListSkeleton />;
  if (pathname.startsWith("/dashboard/payouts")) return <PayoutsSkeleton />;
  if (pathname.startsWith("/dashboard/settings")) return <SettingsSkeleton />;
  return <CardsSkeleton />;
}

function RouteSkeleton() {
  return forRoute(usePathname());
}

/** Shown only until saved state is restored, and only if that takes long enough to notice. Shaped like the route it stands in for. */
export function PageSkeleton() {
  return (
    <div className="dash-skeleton flex flex-col gap-4" role="status" aria-label="Loading dashboard">
      {/* usePathname suspends under a dynamic param unknown at build time. */}
      <Suspense fallback={<FormSkeleton />}><RouteSkeleton /></Suspense>
    </div>
  );
}
