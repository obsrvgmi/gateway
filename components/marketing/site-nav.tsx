"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type MouseEvent } from "react";
import { RiArrowRightLine } from "@remixicon/react";
import { Button as AriaButton, Dialog, Modal, ModalOverlay } from "react-aria-components";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Logo } from "@/components/brand/logo";
import { NavButton } from "@/components/nav-button";
import { cx } from "@/utils/cx";

const LINKS = [
  { href: "#links", label: "Payment Links" },
  { href: "#widgets", label: "Widgets" },
  { href: "/dashboard", label: "Dashboard" },
];
const SECTIONS = ["links", "widgets"];

/**
 * At the top of the page the bar is flush with the hero's gutters and has no surface. Past the
 * top it docks into one machined plate on the page's axis, and its bottom edge fills with reading
 * progress. All of that is CSS on `data-docked`; this component only reports the two facts CSS
 * can't observe: whether the page has left the top, and which section is under the bar.
 */
export function SiteNav() {
  const sentinel = useRef<HTMLSpanElement>(null);
  const links = useRef<HTMLElement>(null);
  const [docked, setDocked] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const top = new IntersectionObserver(([entry]) => setDocked(!entry.isIntersecting));
    if (sentinel.current) top.observe(sentinel.current);

    // A band across the middle of the viewport, so the section reading position is in wins.
    const spy = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setSection(entry.target.id);
          else setSection((current) => (current === entry.target.id ? null : current));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const id of SECTIONS) {
      const element = document.getElementById(id);
      if (element) spy.observe(element);
    }
    return () => {
      top.disconnect();
      spy.disconnect();
    };
  }, []);

  /** The pill rests on the current section, and follows the pointer or focus while they are in the list. */
  const movePill = (target: HTMLElement | null) => {
    const list = links.current;
    if (!list) return;
    list.style.setProperty("--pill-x", `${target ? target.offsetLeft : 0}px`);
    list.style.setProperty("--pill-w", `${target ? target.offsetWidth : 0}px`);
    list.dataset.pill = target ? "on" : "off";
  };
  const restPill = () => movePill(links.current?.querySelector<HTMLElement>("[aria-current]") ?? null);

  useEffect(restPill, [section, docked]);

  const goToSection = (event: MouseEvent, href: string) => {
    setMenuOpen(false);
    if (!href.startsWith("#")) return;
    // Scrolling is locked until the sheet has left, so the jump waits for it.
    event.preventDefault();
    window.setTimeout(() => document.querySelector(href)?.scrollIntoView(), 260);
  };

  return (
    <>
      <span ref={sentinel} aria-hidden className="site-sentinel" />
      <header className="site-nav" data-docked={docked ? "true" : undefined}>
        <div className="site-bar">
          <Link href="/" aria-label="Gateway home" className="site-home">
            <Logo />
          </Link>

          <nav ref={links} aria-label="Primary" className="site-links" onPointerLeave={restPill}>
            <span aria-hidden className="site-pill" />
            {LINKS.map(({ href, label }) => (
              <NavLink
                key={href}
                href={href}
                current={href === `#${section}`}
                onPointerEnter={(event) => movePill(event.currentTarget)}
                onFocus={(event) => movePill(event.currentTarget)}
                onBlur={restPill}
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="site-actions">
            <div className="site-recede">
              <ThemeToggle appearance="segmented" size="small" />
              <NavButton href="/login" variant="ghost" className="site-login">Login</NavButton>
            </div>
            <NavButton href="/login?new=1" className="site-start">Get Started</NavButton>
            <AriaButton aria-label="Open menu" aria-expanded={menuOpen} onPress={() => setMenuOpen(true)} className="site-burger">
              <span aria-hidden /><span aria-hidden />
            </AriaButton>
          </div>

          <span aria-hidden className="site-progress" />
        </div>
      </header>

      <ModalOverlay isOpen={menuOpen} onOpenChange={setMenuOpen} isDismissable className="sheet-overlay">
        <Modal className="sheet">
          <Dialog aria-label="Menu" className="sheet-body">
            <span aria-hidden className="sheet-art" />
            <div className="sheet-head">
              <Logo />
              <AriaButton aria-label="Close menu" onPress={() => setMenuOpen(false)} className="site-burger is-open">
                <span aria-hidden /><span aria-hidden />
              </AriaButton>
            </div>
            <ol className="sheet-links">
              {LINKS.map(({ href, label }, index) => (
                <li key={href} style={{ "--i": index } as CSSProperties}>
                  <a href={href} onClick={(event) => goToSection(event, href)} className="sheet-link">
                    <span aria-hidden className="sheet-index">0{index + 1}</span>
                    {label}
                    <RiArrowRightLine aria-hidden className="sheet-arrow" />
                  </a>
                </li>
              ))}
            </ol>
            <div className="sheet-foot">
              <div className="sheet-row">
                <span className="text-body-medium text-text-secondary">Appearance</span>
                <ThemeToggle appearance="segmented" size="small" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NavButton href="/login" variant="secondary" className="sheet-cta" onClick={() => setMenuOpen(false)}>Login</NavButton>
                <NavButton href="/login?new=1" className="sheet-cta" onClick={() => setMenuOpen(false)}>Get Started</NavButton>
              </div>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}

function NavLink({ href, current, ...props }: { href: string; current: boolean } & ComponentProps<"a">) {
  const className = cx("site-link", current && "is-current");
  if (href.startsWith("#")) return <a href={href} aria-current={current ? "true" : undefined} className={className} {...props} />;
  return <Link href={href} className={className} {...props} />;
}
