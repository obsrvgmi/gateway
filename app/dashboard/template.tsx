export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="dash-route flex flex-col gap-4">{children}</div>;
}
