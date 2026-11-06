import type { ComponentType, ReactNode } from "react";
import type { NotificationAction, NotificationAvatar, NotificationStatus } from "@/components/base/notification/notification";

/**
 * Toast — fire-and-forget notifications from anywhere in the app:
 *
 *   toast.success("Changes saved");
 *   toast.error("Upload failed", { description: "The file is over 20MB." });
 *   const id = toast("Exporting…", { duration: Infinity });
 *   toast.update(id, { title: "Export ready", status: "success", duration: 4000 });
 *   toast.dismiss(id);
 *
 * The store is here and the stack is in ./toaster, so calling toast() pulls in
 * neither Motion nor the card until a toast actually shows (see LazyToaster).
 *
 * Render one <Toaster /> near the root of the app. It draws each toast as a
 * Notification card inside a NotificationViewport, so toasts share the
 * card, status icons, countdown bar, enter and exit motion, and the spring
 * that closes the stack's gaps. Extra Toasters render nothing, so a second
 * one in a nested layout never doubles every toast.
 *
 * The region is a polite live region (errors are announced as alerts). Every
 * countdown pauses while the pointer or keyboard focus is inside the stack,
 * so nobody loses a toast while reading it or reaching for its action.
 */

type IconComponent = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export type ToastId = string | number;

export interface ToastOptions {
  /** Reuse an id to replace a toast that is still showing. */
  id?: ToastId;
  description?: ReactNode;
  status?: NotificationStatus;
  /** Custom leading icon; defaults to the status icon. */
  icon?: IconComponent;
  avatar?: NotificationAvatar;
  /** Small buttons under the message. Pressing one also dismisses the toast. */
  actions?: NotificationAction[];
  /** Milliseconds before it dismisses itself; `Infinity` keeps it until closed. Default from the Toaster (5000). */
  duration?: number;
  /** Show the close button. Default true. */
  dismissible?: boolean;
  /** Called once the toast has left the screen. */
  onDismiss?: () => void;
}

export interface ToastRecord extends ToastOptions {
  id: ToastId;
  title: ReactNode;
  dismissed: boolean;
}

/* -------------------------------------------------------------------- store */

let toasts: ToastRecord[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

export const getToasts = () => toasts;

/** For the Toaster, which drops the oldest toasts past its limit. */
export function setToasts(next: ToastRecord[]) {
  toasts = next;
  emit();
}

export function removeToast(id: ToastId) {
  remove(id);
}

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function show(title: ReactNode, options: ToastOptions = {}): ToastId {
  const id = options.id ?? nextId++;
  const record: ToastRecord = { ...options, id, title, dismissed: false };
  const existing = toasts.findIndex((item) => item.id === id);
  toasts = existing >= 0 ? toasts.map((item, index) => (index === existing ? record : item)) : [...toasts, record];
  emit();
  return id;
}

function remove(id: ToastId) {
  const record = toasts.find((item) => item.id === id);
  toasts = toasts.filter((item) => item.id !== id);
  emit();
  record?.onDismiss?.();
}

/** Show a toast. Returns its id, for `toast.update` and `toast.dismiss`. */
export function toast(title: ReactNode, options?: ToastOptions): ToastId {
  return show(title, options);
}

toast.success = (title: ReactNode, options?: Omit<ToastOptions, "status">) => show(title, { ...options, status: "success" });
toast.error = (title: ReactNode, options?: Omit<ToastOptions, "status">) => show(title, { ...options, status: "error" });
toast.info = (title: ReactNode, options?: Omit<ToastOptions, "status">) => show(title, { ...options, status: "information" });

/** Change a toast that is showing. A new `duration` restarts its countdown. */
toast.update = (id: ToastId, options: ToastOptions & { title?: ReactNode }) => {
  const current = toasts.find((item) => item.id === id && !item.dismissed);
  if (!current) return;
  const { title = current.title, ...rest } = options;
  show(title, { ...current, ...rest, id });
};

/** Dismiss one toast, or every toast when called without an id. */
toast.dismiss = (id?: ToastId) => {
  toasts = toasts.map((item) => (id === undefined || item.id === id ? { ...item, dismissed: true } : item));
  emit();
};
