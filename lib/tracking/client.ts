"use client";
// Fire-and-forget usage tracking. Posts to /api/track, which stamps the session
// email server-side. `keepalive` lets the request survive a navigation/tab close.
// Never throws — a tracking failure must not affect the UI.

export function track(event: string, meta?: Record<string, unknown>): void {
  try {
    const body = JSON.stringify({
      event,
      path: typeof location !== "undefined" ? location.pathname : "",
      meta: meta || {},
    });
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* no-op */
  }
}

// app-open: fire once per loaded tab so we count real active sessions (not just
// fresh sign-ins, which persisted sessions never generate).
let _openSent = false;
export function trackAppOpenOnce(): void {
  if (_openSent) return;
  _openSent = true;
  track("app_open");
}
