"use client";

import Link from "next/link";
import { useState } from "react";
import { RiCheckDoubleLine, RiNotification3Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { actions, useGateway } from "@/lib/store";
import { cx } from "@/utils/cx";
import { relativeTime } from "../fmt";
import { EmptyState, PageHeader, Panel } from "../ui";

export function NotificationsView() {
  const { notifications } = useGateway();
  const unread = notifications.filter((item) => !item.read).length;
  const [now] = useState(Date.now);
  return (
    <>
      <PageHeader title="Notifications" description="Payments, payouts and account changes. Email alerts are set in Settings." actions={<Button variant="secondary" leadingIcon={RiCheckDoubleLine} disabled={!unread} onClick={() => actions.markNotificationsRead()}>Mark all read</Button>} />
      <Panel className="gap-0">
        {notifications.length === 0 ? (
          <EmptyState icon={RiNotification3Line} title="Nothing yet" description="You'll see payments, payouts and account changes here." />
        ) : (
          <ul className="flex flex-col divide-y divide-separator-border">
            {notifications.map((item) => {
              const body = (
                <>
                  <span aria-label={item.read ? undefined : "Unread"} className={cx("mt-2 size-1.5 shrink-0 rounded-full", item.read ? "bg-transparent" : "bg-status-rose-text")} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body-medium">{item.title}</span>
                    {item.body && <span className="text-body-regular text-text-secondary [overflow-wrap:anywhere]">{item.body}</span>}
                  </span>
                  <span className="shrink-0 text-caption-1-regular text-text-secondary">{relativeTime(item.createdAt, now)}</span>
                </>
              );
              return <li key={item.id}>{item.href ? <Link href={item.href} className="flex items-start gap-2.5 rounded-lg py-2.5 outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring">{body}</Link> : <div className="flex items-start gap-2.5 py-2.5">{body}</div>}</li>;
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
