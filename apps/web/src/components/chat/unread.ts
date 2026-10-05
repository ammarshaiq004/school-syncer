"use client";

import { useCallback, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import type { ChatThread, ChatUnread } from "./types";

/**
 * Shared unread-message count for the sidebar badge. One poller serves every subscriber
 * (desktop sidebar and mobile menu), runs only while the tab is visible, and stops when
 * nothing is subscribed. Chat pages push fresher numbers in with `setChatUnreadFromThreads`.
 */
const POLL_MS = 30_000;

let total: number | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

function emit() {
  listeners.forEach((l) => l());
}

function setTotal(next: number | null) {
  if (next === total) return;
  total = next;
  emit();
}

async function load() {
  if (inflight || (typeof document !== "undefined" && document.visibilityState !== "visible")) return;
  inflight = true;
  try {
    const res = await api<ChatUnread>("/chat/unread");
    setTotal(res.total);
  } catch {
    // No chat access or offline: hide the badge rather than show a stale number.
    setTotal(null);
  } finally {
    inflight = false;
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") void load();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    void load();
    timer = setInterval(() => void load(), POLL_MS);
    document.addEventListener("visibilitychange", onVisibility);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearInterval(timer);
      timer = null;
      total = null; // a later subscriber (maybe another account after sign-in) starts fresh
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

const noopSubscribe = () => () => {};
const getSnapshot = () => total;
const getServerSnapshot = () => null;

/** Re-fetch the count now (e.g. after marking a conversation read). */
export function refreshChatUnread() {
  void load();
}

/** Update the badge from a freshly loaded "my conversations" list (saves a request). */
export function setChatUnreadFromThreads(threads: ChatThread[]) {
  setTotal(threads.reduce((sum, t) => sum + (t.role === "OBSERVER" ? 0 : t.unread), 0));
}

/** Unread messages across the user's conversations, or null when unknown or disabled. */
export function useChatUnread(enabled: boolean): number | null {
  const sub = useCallback((l: () => void) => (enabled ? subscribe(l) : noopSubscribe()), [enabled]);
  const value = useSyncExternalStore(sub, getSnapshot, getServerSnapshot);
  return enabled ? value : null;
}
