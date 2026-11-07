import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyLink } from "@/components/auth/verify-link";

export const metadata: Metadata = { title: "Signing in", robots: { index: false } };

export default function VerifyPage() {
  return <Suspense><VerifyLink /></Suspense>;
}
