"use client";

import { useEffect, useState } from "react";
import { AuthCard } from "@/components/auth/auth-card";

interface Health {
  status: string;
  mode?: string;
}

const LABEL: Record<string, string> = {
  ok: "All systems running",
  worker_stalled: "Payments are delayed. Funds are safe, and tracking catches up when this clears.",
  database_unavailable: "We're having a problem. Funds are safe, because we never hold them.",
  live_refused: "Payments are unavailable right now. Funds are safe, because we never hold them.",
};

export function StatusView() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/health").then((response) => response.json() as Promise<Health>).then(setHealth).catch(() => setHealth({ status: "database_unavailable" }));
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <AuthCard title="Status">
      <p role="status" className="text-body-medium">{health ? (LABEL[health.status] ?? health.status) : "Checking"}</p>
      {health?.mode === "sim" && <p className="text-body-regular text-text-secondary">This installation runs in test mode. No real funds move.</p>}
    </AuthCard>
  );
}
