import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** The one frame around sign-in, onboarding and invitations. */
export function AuthCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background-full p-4">
      <Link href="/" aria-label="Gateway home" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"><Logo /></Link>
      <section className="flex w-full max-w-[420px] flex-col gap-4 rounded-3xl border border-border-button-default bg-background-primary-default p-6 text-text-primary shadow-lg">
        <div className="flex flex-col gap-1">
          <h1 className="text-headline-semibold">{title}</h1>
          {description && <p className="text-body-regular text-text-secondary">{description}</p>}
        </div>
        {children}
      </section>
    </main>
  );
}
