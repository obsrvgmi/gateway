"use client";

import { useSyncExternalStore } from "react";
import { DEMO_NOW, EMPTY_STATE, SEED_STATE } from "./seed";
import type { ApiKey, GatewayState, NotificationPrefs, Payment, PaymentLink, Payout, PayoutDestination, PayoutSettings, Settings, TeamMember, Webhook, Widget } from "./types";

const STORAGE_KEY = "gateway:demo-state:v3";
const STALE_KEYS = ["gateway:demo-state:v1", "gateway:demo-state:v2"];

let state = SEED_STATE;
let restored = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function commit(next: GatewayState) {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Demo state simply stops surviving reloads when storage is unavailable.
  }
  emit();
}

function isGatewayState(value: unknown): value is GatewayState {
  const candidate = value as Partial<GatewayState> | null;
  return Boolean(candidate && Array.isArray(candidate.links) && Array.isArray(candidate.widgets) && Array.isArray(candidate.payments) && Array.isArray(candidate.payouts) && candidate.settings?.payouts);
}

/** A simulated payment can't outlive the page that was driving it, so it lands on restore. */
function finishSimulated(saved: GatewayState): GatewayState {
  return {
    ...saved,
    payments: saved.payments.some((payment) => payment.simulated && payment.status === "processing")
      ? saved.payments.map((payment) => (payment.simulated && payment.status === "processing" ? { ...payment, status: "settled", settleSeconds: 24 } : payment))
      : saved.payments,
    // Same for a payout whose timer died with its tab.
    payouts: saved.payouts.some((payout) => payout.status === "processing")
      ? saved.payouts.map((payout) => (payout.status === "processing" ? { ...payout, status: "sent", completedAt: payout.createdAt } : payout))
      : saved.payouts,
  };
}

function read() {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  const parsed: unknown = JSON.parse(saved);
  return isGatewayState(parsed) ? finishSimulated(parsed) : null;
}

function restore() {
  restored = true;
  try {
    STALE_KEYS.forEach((key) => window.localStorage.removeItem(key));
    const saved = read();
    if (saved) state = saved;
  } catch {
    // A corrupt or blocked entry falls back to the seed data.
  }
  // Another tab (a hosted checkout, usually) writing the same key updates this one.
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    try {
      state = read() ?? SEED_STATE;
      emit();
    } catch {
      // Ignore a bad write from another tab; this tab keeps its state.
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!restored) {
    restore();
    // The snapshot changed during subscribe; tell every hook that is already mounted.
    queueMicrotask(emit);
  }
  return () => listeners.delete(listener);
}

export function useGateway() {
  return useSyncExternalStore(subscribe, () => state, () => SEED_STATE);
}

/** False on the server and until saved state is restored. Gate anything that reads the store into local state. */
export function useGatewayReady() {
  return useSyncExternalStore(subscribe, () => restored, () => false);
}

/** The current state, for event handlers outside React. */
export const getGateway = () => state;

export function newId(prefix: string, length = 6) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return `${prefix}${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
}

/** New payments land just after the newest one, so the fixed demo timeline never drifts from the wall clock. */
function nextPaymentTime(payments: Payment[]) {
  const newest = payments.reduce((latest, payment) => Math.max(latest, new Date(payment.createdAt).getTime()), DEMO_NOW);
  return new Date(newest + 45_000).toISOString();
}

export const actions = {
  addLink(link: PaymentLink) {
    commit({ ...state, links: [link, ...state.links] });
  },
  updateLink(id: string, patch: Partial<PaymentLink>) {
    const title = patch.title;
    commit({
      ...state,
      links: state.links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
      payments: title ? state.payments.map((payment) => (payment.sourceId === id ? { ...payment, sourceName: title } : payment)) : state.payments,
    });
  },
  removeLink(id: string) {
    commit({ ...state, links: state.links.filter((link) => link.id !== id) });
  },
  addWidget(widget: Widget) {
    commit({ ...state, widgets: [widget, ...state.widgets] });
  },
  updateWidget(id: string, patch: Partial<Widget>) {
    const name = patch.name;
    commit({
      ...state,
      widgets: state.widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
      payments: name ? state.payments.map((payment) => (payment.sourceId === id ? { ...payment, sourceName: name } : payment)) : state.payments,
    });
  },
  removeWidget(id: string) {
    commit({ ...state, widgets: state.widgets.filter((widget) => widget.id !== id) });
  },
  recordPayment(payment: Payment) {
    commit({ ...state, payments: [{ ...payment, createdAt: nextPaymentTime(state.payments) }, ...state.payments] });
  },
  settlePayment(id: string, settleSeconds: number) {
    commit({ ...state, payments: state.payments.map((payment) => (payment.id === id && payment.status === "processing" ? { ...payment, status: "settled", settleSeconds } : payment)) });
  },
  refundPayments(ids: string[]) {
    const targets = new Set(ids);
    const refundedAt = nextPaymentTime(state.payments);
    commit({ ...state, payments: state.payments.map((payment) => (targets.has(payment.id) && payment.status === "settled" ? { ...payment, status: "refunded", refundedAt } : payment)) });
  },
  updateSettings(patch: Partial<Settings>) {
    commit({ ...state, settings: { ...state.settings, ...patch } });
  },
  addPayout(payout: Payout) {
    commit({ ...state, payouts: [{ ...payout, createdAt: nextPaymentTime(state.payments) }, ...state.payouts] });
  },
  updatePayout(id: string, patch: Partial<Payout>) {
    commit({ ...state, payouts: state.payouts.map((payout) => (payout.id === id ? { ...payout, ...patch } : payout)) });
  },
  updatePayoutSettings(patch: Partial<PayoutSettings>) {
    commit({ ...state, settings: { ...state.settings, payouts: { ...state.settings.payouts, ...patch } } });
  },
  addDestination(destination: PayoutDestination) {
    const { payouts } = state.settings;
    commit({ ...state, settings: { ...state.settings, payouts: { ...payouts, destinations: [...payouts.destinations, destination] } } });
  },
  /** `walletAddress` is the default destination's address, kept in step for everything that shows it. */
  setDefaultDestination(id: string) {
    const destination = state.settings.payouts.destinations.find((item) => item.id === id);
    if (!destination) return;
    commit({ ...state, settings: { ...state.settings, walletAddress: destination.address, payouts: { ...state.settings.payouts, defaultDestinationId: id } } });
  },
  removeDestination(id: string) {
    const { payouts } = state.settings;
    if (id === payouts.defaultDestinationId) return;
    commit({ ...state, settings: { ...state.settings, payouts: { ...payouts, destinations: payouts.destinations.filter((item) => item.id !== id) } } });
  },
  updateNotifications(patch: Partial<NotificationPrefs>) {
    commit({ ...state, settings: { ...state.settings, notifications: { ...state.settings.notifications, ...patch } } });
  },
  addApiKey(key: ApiKey) {
    commit({ ...state, settings: { ...state.settings, apiKeys: [key, ...state.settings.apiKeys] } });
  },
  revokeApiKey(id: string) {
    commit({ ...state, settings: { ...state.settings, apiKeys: state.settings.apiKeys.filter((key) => key.id !== id) } });
  },
  addWebhook(webhook: Webhook) {
    commit({ ...state, settings: { ...state.settings, webhooks: [webhook, ...state.settings.webhooks] } });
  },
  updateWebhook(id: string, patch: Partial<Webhook>) {
    commit({ ...state, settings: { ...state.settings, webhooks: state.settings.webhooks.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)) } });
  },
  removeWebhook(id: string) {
    commit({ ...state, settings: { ...state.settings, webhooks: state.settings.webhooks.filter((hook) => hook.id !== id) } });
  },
  inviteMember(member: TeamMember) {
    commit({ ...state, settings: { ...state.settings, team: [...state.settings.team, member] } });
  },
  updateMember(id: string, patch: Partial<TeamMember>) {
    commit({ ...state, settings: { ...state.settings, team: state.settings.team.map((member) => (member.id === id ? { ...member, ...patch } : member)) } });
  },
  removeMember(id: string) {
    commit({ ...state, settings: { ...state.settings, team: state.settings.team.filter((member) => member.id !== id) } });
  },
  dismissSetup() {
    commit({ ...state, setupDismissed: true });
  },
  showSetup() {
    commit({ ...state, setupDismissed: false });
  },
  /** Puts back a state read from `getGateway()`, for undoing a clear or a restore. */
  restoreSnapshot(snapshot: GatewayState) {
    commit(snapshot);
  },
  clearDemoData() {
    commit({ ...EMPTY_STATE, settings: state.settings });
  },
  restoreDemoData() {
    commit(SEED_STATE);
  },
};
