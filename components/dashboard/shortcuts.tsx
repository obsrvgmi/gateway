"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/base/buttons/button";
import { Kbd } from "@/components/base/kbd/kbd";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { guardedPush } from "./unsaved";

const JUMPS: Record<string, { href: string; label: string }> = {
  o: { href: "/dashboard", label: "Overview" },
  p: { href: "/dashboard/payments", label: "Payments" },
  u: { href: "/dashboard/payouts", label: "Payouts" },
  l: { href: "/dashboard/links", label: "Payment links" },
  w: { href: "/dashboard/widgets", label: "Widgets" },
  n: { href: "/dashboard/notifications", label: "Notifications" },
  t: { href: "/dashboard/statements", label: "Statements" },
  s: { href: "/dashboard/settings", label: "Settings" },
};

const isTyping = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.closest("[role=dialog]")));
};

/** `g` then a letter jumps to a page, `c` starts a new link, `?` lists them. Off while typing or in a dialog. */
export function Shortcuts() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let leader = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (Date.now() - leader < 1200) {
        leader = 0;
        const jump = JUMPS[key];
        if (jump) {
          event.preventDefault();
          guardedPush(router, jump.href);
        }
        return;
      }
      if (key === "g") leader = Date.now();
      else if (key === "c") guardedPush(router, "/dashboard/links/new");
      else if (event.key === "?") setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return (
    <Modal isOpen={open} onOpenChange={setOpen} size="sm" aria-label="Keyboard shortcuts">
      <ModalHeader title="Keyboard shortcuts" />
      <ModalBody className="pb-1">
        <dl className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3"><dt className="text-body-regular">Search</dt><dd><Kbd>⌘K</Kbd></dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-body-regular">New payment link</dt><dd><Kbd>C</Kbd></dd></div>
          {Object.entries(JUMPS).map(([key, jump]) => (
            <div key={key} className="flex items-center justify-between gap-3"><dt className="text-body-regular">Go to {jump.label.toLowerCase()}</dt><dd className="flex gap-1"><Kbd>G</Kbd><Kbd>{key.toUpperCase()}</Kbd></dd></div>
          ))}
        </dl>
      </ModalBody>
      <ModalFooter><Button onClick={() => setOpen(false)}>Close</Button></ModalFooter>
    </Modal>
  );
}
