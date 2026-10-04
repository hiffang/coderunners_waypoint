"use client";

import { useEffect } from "react";

/**
 * The one shared app service worker (public/sw.js). It precaches the static
 * mobile shells (/driver/shell, /loader/shell when present) and their chunks,
 * serves them for portal navigations that fail offline, and never caches API
 * responses or personalized pages.
 */
const SW_URL = "/sw.js";

export function swEnabled() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    (process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW === "true")
  );
}

/** Mount once (lead: root layout). Registers the worker and refreshes the shells when online. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!swEnabled()) return;
    navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then(() => {
        if (navigator.onLine) void refreshOfflineShells();
      })
      .catch((err) => console.warn("Service worker registration failed", err));
  }, []);
  return null;
}

export type ShellStatus = { ok: boolean; shells: string[]; error?: string };

/**
 * Ask the worker to (re)download the offline shells and their static chunks.
 * Resolves once they are cached, so the UI can honestly say "available offline".
 */
export async function refreshOfflineShells(timeoutMs = 30_000): Promise<ShellStatus> {
  if (!swEnabled()) return { ok: false, shells: [], error: "Offline app shell needs a production build over HTTPS or localhost" };
  const reg = await navigator.serviceWorker.ready;
  const worker = reg.active;
  if (!worker) return { ok: false, shells: [], error: "Service worker not active yet" };
  return new Promise<ShellStatus>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ ok: false, shells: [], error: "Timed out caching the offline shell" }), timeoutMs);
    channel.port1.onmessage = (ev: MessageEvent<ShellStatus>) => {
      clearTimeout(timer);
      resolve(ev.data);
    };
    worker.postMessage({ type: "refresh-shells" }, [channel.port2]);
  });
}

/** Whether a shell for `path` is cached right now (checks Cache Storage directly). */
export async function hasOfflineShell(path: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  const keys = await caches.keys();
  for (const k of keys.filter((n) => n.startsWith("waypoint-shell-"))) {
    const c = await caches.open(k);
    if (await c.match(path)) return true;
  }
  return false;
}
