import "./dashboard.css";
import { DashboardShell } from "@/components/dashboard/shell";

export default function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  return <DashboardShell>{children}</DashboardShell>;
}
