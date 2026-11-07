import type { Metadata } from "next";
import { StatusView } from "@/components/status-view";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  return <StatusView />;
}
