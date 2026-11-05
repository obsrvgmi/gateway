"use client";

import Link from "next/link";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { NavButton } from "@/components/nav-button";

export function SiteNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-10">
      <div className="stage-nav">
        <Link href="/" aria-label="Home" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <Logo />
        </Link>
        <nav aria-label="Account" className="flex items-center gap-2">
          <ThemeToggle appearance="segmented" size="small" className="hidden sm:flex" />
          <NavButton href="/dashboard" variant="ghost" className="stage-login">Login</NavButton>
          <NavButton href="/dashboard">Get Started</NavButton>
        </nav>
      </div>
    </header>
  );
}
