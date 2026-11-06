"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Notification, NotificationViewport, type NotificationPosition } from "@/components/base/notification/notification";
import { cx } from "@/utils/cx";
import { getToasts, removeToast, setToasts, subscribeToToasts, toast } from "./toast";

/* ------------------------------------------------------------------ toaster */

// Only the first mounted Toaster draws the stack; the rest stand by and take
// over if it unmounts.
let owners: string[] = [];
const ownerListeners = new Set<() => void>();

function subscribeOwners(listener: () => void) {
  ownerListeners.add(listener);
  return () => {
    ownerListeners.delete(listener);
  };
}

export interface ToasterProps {
  /** Edge or corner the stack is anchored to. Default `bottom-end`. */
  position?: NotificationPosition;
  /** How many toasts show at once; older ones leave as new ones arrive. Default 3. */
  limit?: number;
  /** Default countdown in milliseconds. Default 5000. */
  duration?: number;
  /** Accessible name of the region. */
  "aria-label"?: string;
  /** Accessible name of each toast's close button. */
  closeLabel?: string;
  className?: string;
}

export function Toaster({
  position = "bottom-end",
  limit = 3,
  duration = 5000,
  "aria-label": ariaLabel = "Notifications",
  closeLabel,
  className,
}: ToasterProps) {
  const ownerId = useId();
  const items = useSyncExternalStore(subscribeToToasts, getToasts, getToasts);
  const isOwner = useSyncExternalStore(subscribeOwners, () => owners[0] === ownerId, () => false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    owners = [...owners, ownerId];
    ownerListeners.forEach((listener) => listener());
    return () => {
      owners = owners.filter((owner) => owner !== ownerId);
      ownerListeners.forEach((listener) => listener());
    };
  }, [ownerId]);

  // Past the limit, the oldest toasts play their exit and make room.
  useEffect(() => {
    if (!isOwner) return;
    const active = items.filter((item) => !item.dismissed);
    if (active.length > limit) {
      const overflow = new Set(active.slice(0, active.length - limit).map((item) => item.id));
      setToasts(getToasts().map((item) => (overflow.has(item.id) ? { ...item, dismissed: true } : item)));
    }
  }, [items, limit, isOwner]);

  // A toast removed from under the pointer or focus fires no leave or blur,
  // so an emptied stack resets both, or the next toast would start paused.
  const empty = items.length === 0;
  const [wasEmpty, setWasEmpty] = useState(empty);
  if (empty !== wasEmpty) {
    setWasEmpty(empty);
    if (empty) {
      setHovered(false);
      setFocused(false);
    }
  }

  if (!isOwner) return null;

  return (
    <NotificationViewport
      position={position}
      aria-label={ariaLabel}
      role="region"
      aria-live="polite"
      aria-relevant="additions text"
      className={cx("z-130", className)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      {items.map((item) => {
        const timeout = item.duration ?? duration;
        return (
          <Notification
            // A toast replaced under the same id remounts, so its countdown restarts.
            key={`${item.id}:${timeout}`}
            title={item.title}
            description={item.description}
            status={item.status}
            icon={item.icon}
            avatar={item.avatar}
            dismissible={item.dismissible ?? true}
            closeLabel={closeLabel}
            actions={item.actions?.map((action) => ({
              ...action,
              onClick: () => {
                action.onClick?.();
                toast.dismiss(item.id);
              },
            }))}
            autoDismissDuration={Number.isFinite(timeout) && timeout > 0 ? timeout : undefined}
            paused={hovered || focused}
            dismissed={item.dismissed}
            introDelay={0}
            onDismiss={() => removeToast(item.id)}
          />
        );
      })}
    </NotificationViewport>
  );
}
