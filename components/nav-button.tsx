"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";
import { ButtonLink } from "@/components/base/buttons/button";

/** BoardUI's link button, with client-side navigation. */
export function NavButton({ href, onClick, ...props }: ComponentProps<typeof ButtonLink> & { href: string }) {
  const router = useRouter();
  return (
    <ButtonLink
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        router.push(href);
      }}
    />
  );
}
