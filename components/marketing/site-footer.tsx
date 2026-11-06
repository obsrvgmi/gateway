"use client";

import Link from "next/link";
import { RiArrowRightLine } from "@remixicon/react";
import { LogoMark } from "@/components/brand/logo";
import { NavButton } from "@/components/nav-button";
import { SITE } from "@/lib/site";
import { Bus } from "./bus";

const LINKS = [
  { href: "#links", label: "Payment Links" },
  { href: "#widgets", label: "Widgets" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/pay/lnk_8fk2m1", label: "Try a payment" },
];
const MICROPRINT = "SPECIMEN  NO FUNDS MOVE  ANY ASSET IN  ONE ASSET OUT  ".repeat(14);

/**
 * The reverse of the note: the same ink in both themes, so the page always ends on the same frame.
 * `dark` scopes every token below it. The channel from the page's axis ends at the seal, where the
 * money settles, and the wordmark is a mask over two counter-rotating rosettes, which is what makes
 * the moire in the letters live. See the footer block in styles/landing.css.
 */
export function SiteFooter() {
  return (
    <footer className="foot dark">
      <span aria-hidden className="foot-port"><span className="stage-socket is-main" /></span>
      <div aria-hidden className="foot-art"><i /><i /></div>

      <div className="foot-frame">
        <Bus span={120} delay={-1.2} className="foot-bus" />
        <div className="foot-close">
          <span aria-hidden className="foot-seal"><span className="foot-seal-ring" /><span className="logo-key foot-seal-key"><LogoMark className="size-7" /></span></span>
          <h2 className="foot-title">Any asset in.<br /> One asset out.</h2>
          <div className="foot-actions">
            <NavButton href="/dashboard/links/new" trailingIcon={RiArrowRightLine} className="stage-cta">Create Payment Link</NavButton>
            <NavButton href="/pay/lnk_8fk2m1" variant="secondary" className="stage-cta">Try a payment</NavButton>
          </div>
        </div>

        <nav aria-label="Footer" className="foot-nav">
          {LINKS.map(({ href, label }) => (
            href.startsWith("#")
              ? <a key={href} href={href} className="foot-link">{label}</a>
              : <Link key={href} href={href} className="foot-link">{label}</Link>
          ))}
        </nav>

        <p aria-hidden className="foot-word"><i /><i /></p>

        <p aria-hidden className="foot-micro">{MICROPRINT}</p>
        <div className="foot-legal">
          <p>{SITE.name} is a working name and a working demo. Payments here are simulated and no funds move.</p>
          <p className="foot-powered"><span aria-hidden className="stage-powered-dot" />Powered by NEAR Intents</p>
        </div>
      </div>
    </footer>
  );
}
