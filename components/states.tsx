"use client";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state state-loading">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <strong>Couldn&apos;t load this.</strong>
      <span>{message}</span>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="state state-empty">
      <div className="empty-mark" aria-hidden>
        ◍
      </div>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}
