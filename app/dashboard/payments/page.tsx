import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentsView } from "@/components/dashboard/views/payments";

// DashboardShell mounts this page only after the workspace loads.
export const instant = false;
export const metadata: Metadata = { title: "Payments" };

export default function Page() {
  return (
    <Suspense>
      <PaymentsView />
    </Suspense>
  );
}
