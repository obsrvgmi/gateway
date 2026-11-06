import type { Metadata } from "next";
import { OnboardingForm } from "@/components/auth/onboarding-form";

export const metadata: Metadata = { title: "Set up your workspace", robots: { index: false } };

export default function OnboardingPage() {
  return <OnboardingForm />;
}
