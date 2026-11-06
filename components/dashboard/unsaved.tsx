"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertDialog } from "@/components/base/modal/modal";

let intercept: ((href: string) => void) | null = null;

/** For menus and the palette, which navigate with the router rather than an anchor. */
export function guardedPush(router: ReturnType<typeof useRouter>, href: string) {
  // A frame later, so the menu or palette that called this has finished closing and can't take the dialog with it.
  if (intercept) requestAnimationFrame(() => intercept?.(href));
  else router.push(href);
}

/**
 * Asks before an edit is abandoned by a link, a menu, the palette, a reload or closing the tab.
 * The App Router has no way to block history navigation, so the browser's Back button is not covered.
 * Render the returned dialog in the form.
 */
export function useUnsavedGuard(dirty: boolean) {
  const router = useRouter();
  const [target, setTarget] = useState<string | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!leaving.current) event.preventDefault();
    };
    // Capture on document runs before React's root listener, so the link's own handler never fires.
    const onClick = (event: MouseEvent) => {
      if (leaving.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank") return;
      const url = new URL(anchor.href);
      if (url.origin !== window.location.origin || (url.pathname === window.location.pathname && url.search === window.location.search)) return;
      event.preventDefault();
      event.stopPropagation();
      setTarget(`${url.pathname}${url.search}${url.hash}`);
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    intercept = setTarget;
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
      intercept = null;
    };
  }, [dirty]);

  return (
    <AlertDialog
      isOpen={target !== null}
      onOpenChange={(open) => !open && setTarget(null)}
      title="Discard unsaved changes?"
      description="Your edits haven't been saved. They'll be lost if you leave this page."
      cancelLabel="Keep editing"
      confirmLabel="Discard changes"
      onConfirm={() => {
        leaving.current = true;
        const href = target;
        setTarget(null);
        if (href) router.push(href);
      }}
    />
  );
}
