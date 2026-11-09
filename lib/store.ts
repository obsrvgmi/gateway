"use client";

import { useSyncExternalStore } from "react";
import { toast } from "@/components/base/toast/toast";
import { api, ApiError, errorMessage } from "./api";
import { EMPTY_STATE } from "./defaults";
import type { GatewayState, NotificationPrefs, PaymentLink, PayoutDestination, PayoutSettings, Settings, TeamMember, TeamRole, Webhook, Widget } from "./types";

const POLL_MS = 8_000;

let state: GatewayState = EMPTY_STATE;
let ready = false;
let started = false;
let lastSync: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function commit(next: GatewayState) {
  state = next;
  emit();
}

const keepNewest = <T extends { id: string }>(current: T[], incoming: T[]) => {
  if (!incoming.length) return current;
  const byId = new Map(incoming.map((item) => [item.id, item]));
  const known = current.map((item) => byId.get(item.id) ?? item);
  const seen = new Set(current.map((item) => item.id));
  return [...incoming.filter((item) => !seen.has(item.id)), ...known];
};

function toLogin() {
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.assign(`/login?next=${next}`);
}

/** Loads everything for the signed-in workspace. Callers needing a full refresh, such as after a wallet change, use this. */
export async function refresh() {
  const started_at = new Date().toISOString();
  try {
    const next = await api<GatewayState>("/api/state");
    lastSync = started_at;
    ready = true;
    commit(next);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return toLogin();
    if (error instanceof ApiError && error.code === "no_workspace") return window.location.assign("/onboarding");
    if (!ready) toast.error("Couldn't load your dashboard", { id: "load", description: errorMessage(error) });
  }
}

interface Changes {
  payments: GatewayState["payments"];
  payouts: GatewayState["payouts"];
  settlement: GatewayState["settlement"];
  notifications: GatewayState["notifications"];
  at: string;
}

/** Payments move on their own, so the dashboard asks what changed rather than re-downloading its history. */
async function poll() {
  if (!lastSync || document.visibilityState !== "visible") return;
  try {
    const changes = await api<Changes>(`/api/state/changes?since=${encodeURIComponent(lastSync)}`);
    lastSync = changes.at;
    commit({ ...state, payments: keepNewest(state.payments, changes.payments), payouts: keepNewest(state.payouts, changes.payouts), settlement: changes.settlement, notifications: changes.notifications });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) toLogin();
  }
}

function start() {
  if (started) return;
  started = true;
  void refresh();
  window.setInterval(() => void poll(), POLL_MS);
  document.addEventListener("visibilitychange", () => void poll());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

export function useGateway() {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY_STATE);
}

/** False on the server and until the first load finishes. Gate anything that reads the store into local state. */
export function useGatewayReady() {
  return useSyncExternalStore(subscribe, () => ready, () => false);
}

/** The current state, for event handlers outside React. */
export const getGateway = () => state;

/** Sets a value here right away, and puts it back with an error if the server refuses. */
function optimistic(next: GatewayState, request: () => Promise<unknown>, onSaved?: (result: unknown) => void) {
  const before = state;
  commit(next);
  request().then(onSaved).catch((error) => {
    commit(before);
    toast.error("That didn't save", { description: errorMessage(error) });
  });
}

export function newId(prefix: string, length = 20) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return `${prefix}${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

const patchSettings = (body: Record<string, unknown>) => api("/api/settings", { method: "PATCH", body });

function linkBody({ id, title, description, amount, receiveAsset, status, expiresAt, successUrl, metadata, singleUse, publicStats }: PaymentLink) {
  return { id, title, description, amount, receiveAsset, status, expiresAt, successUrl, metadata, singleUse, publicStats };
}

function widgetBody(widget: Widget) {
  const { createdAt: _createdAt, ...fields } = widget;
  void _createdAt;
  return fields;
}

export const actions = {
  addLink(link: PaymentLink) {
    optimistic({ ...state, links: [link, ...state.links.filter((item) => item.id !== link.id)] }, () => api("/api/links", { body: linkBody(link) }));
  },
  updateLink(id: string, patch: Partial<PaymentLink>) {
    const title = patch.title;
    optimistic(
      {
        ...state,
        links: state.links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
        payments: title ? state.payments.map((payment) => (payment.sourceId === id ? { ...payment, sourceName: title } : payment)) : state.payments,
      },
      () => api(`/api/links/${id}`, { method: "PATCH", body: patch }),
    );
  },
  removeLink(id: string) {
    optimistic({ ...state, links: state.links.filter((link) => link.id !== id) }, () => api(`/api/links/${id}`, { method: "DELETE" }));
  },
  addWidget(widget: Widget) {
    optimistic({ ...state, widgets: [widget, ...state.widgets.filter((item) => item.id !== widget.id)] }, () => api("/api/widgets", { body: widgetBody(widget) }));
  },
  updateWidget(id: string, patch: Partial<Widget>) {
    const name = patch.name;
    optimistic(
      {
        ...state,
        widgets: state.widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
        payments: name ? state.payments.map((payment) => (payment.sourceId === id ? { ...payment, sourceName: name } : payment)) : state.payments,
      },
      () => api(`/api/widgets/${id}`, { method: "PATCH", body: patch }),
    );
  },
  removeWidget(id: string) {
    optimistic({ ...state, widgets: state.widgets.filter((widget) => widget.id !== id) }, () => api(`/api/widgets/${id}`, { method: "DELETE" }));
  },
  updateSettings(patch: Partial<Settings>) {
    optimistic({ ...state, settings: { ...state.settings, ...patch } }, () => patchSettings(patch));
  },
  updatePayoutSettings(patch: Partial<PayoutSettings>) {
    optimistic({ ...state, settings: { ...state.settings, payouts: { ...state.settings.payouts, ...patch } } }, () => patchSettings({ payouts: patch }));
  },
  /** Called after the server accepted a destination, which may have needed a wallet signature. */
  destinationAdded(destination: PayoutDestination) {
    const { payouts } = state.settings;
    commit({ ...state, settings: { ...state.settings, payouts: { ...payouts, destinations: [...payouts.destinations, destination] } } });
  },
  /** `walletAddress` is the default destination's address, kept in step for everything that shows it. */
  setDefaultDestination(id: string) {
    const destination = state.settings.payouts.destinations.find((item) => item.id === id);
    if (!destination) return;
    optimistic({ ...state, settings: { ...state.settings, walletAddress: destination.address, payouts: { ...state.settings.payouts, defaultDestinationId: id } } }, () => api(`/api/destinations/${id}/default`, { method: "POST", body: {} }));
  },
  removeDestination(id: string) {
    const { payouts } = state.settings;
    if (id === payouts.defaultDestinationId) return;
    optimistic({ ...state, settings: { ...state.settings, payouts: { ...payouts, destinations: payouts.destinations.filter((item) => item.id !== id) } } }, () => api(`/api/destinations/${id}`, { method: "DELETE" }));
  },
  updateNotifications(patch: Partial<NotificationPrefs>) {
    const notifications = { ...state.settings.notifications, ...patch };
    optimistic({ ...state, settings: { ...state.settings, notifications } }, () => patchSettings({ notifications }));
  },
  keyCreated(key: Settings["apiKeys"][number]) {
    commit({ ...state, settings: { ...state.settings, apiKeys: [key, ...state.settings.apiKeys] } });
  },
  revokeApiKey(id: string) {
    optimistic({ ...state, settings: { ...state.settings, apiKeys: state.settings.apiKeys.filter((key) => key.id !== id) } }, () => api(`/api/api-keys/${id}`, { method: "DELETE" }));
  },
  webhookCreated(webhook: Webhook) {
    commit({ ...state, settings: { ...state.settings, webhooks: [webhook, ...state.settings.webhooks] } });
  },
  updateWebhook(id: string, patch: { enabled: boolean }) {
    optimistic({ ...state, settings: { ...state.settings, webhooks: state.settings.webhooks.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)) } }, () => api(`/api/webhooks/${id}`, { method: "PATCH", body: patch }));
  },
  removeWebhook(id: string) {
    optimistic({ ...state, settings: { ...state.settings, webhooks: state.settings.webhooks.filter((hook) => hook.id !== id) } }, () => api(`/api/webhooks/${id}`, { method: "DELETE" }));
  },
  async inviteMember(email: string, role: TeamRole) {
    const member = await api<TeamMember>("/api/team/invites", { body: { email, role } });
    commit({ ...state, settings: { ...state.settings, team: [...state.settings.team, member] } });
  },
  removeMember(member: TeamMember) {
    const path = member.status === "invited" ? `/api/team/invites/${member.id}` : `/api/team/members/${member.id}`;
    optimistic({ ...state, settings: { ...state.settings, team: state.settings.team.filter((item) => item.id !== member.id) } }, () => api(path, { method: "DELETE" }));
  },
  dismissSetup() {
    optimistic({ ...state, setupDismissed: true }, () => patchSettings({ setupDismissed: true }));
  },
  showSetup() {
    optimistic({ ...state, setupDismissed: false }, () => patchSettings({ setupDismissed: false }));
  },
  markNotificationsRead() {
    optimistic({ ...state, notifications: state.notifications.map((item) => ({ ...item, read: true })) }, () => api("/api/notifications/read", { body: {} }));
  },
};

export async function logOut() {
  await api("/api/auth/logout", { body: {} }).catch(() => undefined);
  window.location.assign("/");
}
