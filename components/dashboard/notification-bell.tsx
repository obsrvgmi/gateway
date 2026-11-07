"use client";

import Link from "next/link";
import { useState } from "react";
import { RiNotification3Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Popover, PopoverTrigger } from "@/components/base/popover/popover";
import { actions, useGateway } from "@/lib/store";
import { relativeTime } from "./fmt";

/** The newest few, with an unread count. Everything is on the notifications page. */
export function NotificationBell() {
  const { notifications } = useGateway();
  const [open, setOpen] = useState(false);
  const [now] = useState(Date.now);
  const unread = notifications.filter((item) => !item.read).length;
  return (
    <PopoverTrigger isOpen={open} onOpenChange={(next) => { setOpen(next); if (!next && unread) actions.markNotificationsRead(); }}>
      <Button variant="ghost" iconOnly leadingIcon={RiNotification3Line} aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className={unread ? "relative after:absolute after:end-1 after:top-1 after:size-2 after:rounded-full after:bg-status-rose-text" : undefined} />
      <Popover placement="bottom end" className="w-[320px] p-2">
        <div className="flex flex-col gap-1">
          {notifications.length === 0 && <p className="p-2 text-body-regular text-text-secondary">Nothing yet. Payments and payouts show up here.</p>}
          {notifications.slice(0, 6).map((item) => (
            <Link key={item.id} href={item.href || "/dashboard/notifications"} onClick={() => setOpen(false)} className="flex flex-col rounded-lg p-2 outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring">
              <span className="flex items-center gap-2">
                {!item.read && <span aria-label="Unread" className="size-1.5 shrink-0 rounded-full bg-status-rose-text" />}
                <span className="truncate text-body-medium">{item.title}</span>
              </span>
              {item.body && <span className="truncate text-caption-1-regular text-text-secondary">{item.body}</span>}
              <span className="text-caption-1-regular text-text-tertiary">{relativeTime(item.createdAt, now)}</span>
            </Link>
          ))}
          <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="rounded-lg p-2 text-center text-body-medium text-text-accent outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring">See all</Link>
        </div>
      </Popover>
    </PopoverTrigger>
  );
}
