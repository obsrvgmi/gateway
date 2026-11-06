"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/base/skeleton/skeleton";

const Header = () => (
  <div className="flex flex-col gap-1">
    <Skeleton shape="text" className="h-9 w-48" />
    <Skeleton shape="text" className="h-[1.125rem] w-72 max-w-full" />
  </div>
);

const Tile = ({ className = "col-span-6 h-[6.5rem] @5xl:col-span-3" }: { className?: string }) => <Skeleton className={`${className} rounded-3xl`} />;

function OverviewSkeleton() {
  return (
    <>
      <Header />
      <Skeleton className="h-[10.5rem] rounded-3xl @[56rem]:h-[6.5rem]" />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Skeleton className="col-span-12 h-[28rem] rounded-3xl @5xl:col-span-8" />
        <Skeleton className="col-span-12 h-[28rem] rounded-3xl @5xl:col-span-4" />
        {[0, 1, 2, 3].map((key) => <Tile key={key} />)}
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <>
      <Header />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        {[0, 1, 2, 3].map((key) => <Tile key={key} />)}
        <Skeleton className="col-span-12 h-[39rem] rounded-3xl @5xl:col-span-9" />
        <Skeleton className="col-span-12 h-64 rounded-3xl @5xl:col-span-3" />
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
        <Skeleton className="col-span-12 h-80 rounded-3xl @5xl:col-span-7" />
        <Skeleton className="col-span-12 h-80 rounded-3xl @5xl:col-span-5" />
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
        {[0, 1, 2, 3, 4, 5].map((key) => <Skeleton key={key} className="col-span-12 h-60 rounded-3xl @xl:col-span-6 @5xl:col-span-4" />)}
      </div>
    </>
  );
}

function FormSkeleton() {
  return (
    <>
      <Header />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Skeleton className="col-span-12 h-[39rem] rounded-3xl @4xl:col-span-7" />
        <Skeleton className="col-span-12 h-[28rem] rounded-3xl @4xl:col-span-5" />
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
