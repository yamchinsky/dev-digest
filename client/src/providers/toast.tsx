/* toast.tsx — A6 cross-cutting: system-level notifications.
   Error UX taxonomy: system errors → toast (here); form errors → inline;
   critical → full-screen (ErrorState fullScreen). */
"use client";

import React from "react";

type ToastKind = "success" | "error" | "info";

/** Optional extras for a toast notification. Currently supports a navigation
    href (AC-6) so success toasts can link the user to the relevant page. */
export interface ToastOpts {
  href?: string;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  href?: string;
}

interface ToastApi {
  toast: (message: string, kind?: ToastKind, opts?: ToastOpts) => void;
  success: (m: string, opts?: ToastOpts) => void;
  error: (m: string, opts?: ToastOpts) => void;
  info: (m: string, opts?: ToastOpts) => void;
}

const ToastCtx = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/* Module-level bridge so non-React code (e.g. the React Query cache) can raise
   toasts without the hook. The mounted <ToastProvider> registers its pusher. */
type Pusher = (message: string, kind?: ToastKind, href?: string) => void;
let activePusher: Pusher | null = null;
export const notify = {
  toast: (m: string, k?: ToastKind, opts?: ToastOpts) => activePusher?.(m, k, opts?.href),
  success: (m: string, opts?: ToastOpts) => activePusher?.(m, "success", opts?.href),
  error: (m: string, opts?: ToastOpts) => activePusher?.(m, "error", opts?.href),
  info: (m: string, opts?: ToastOpts) => activePusher?.(m, "info", opts?.href),
};

const COLORS: Record<ToastKind, { bg: string; border: string; icon: string }> = {
  success: { bg: "var(--ok-bg, #052e1c)", border: "var(--ok)", icon: "✓" },
  error: { bg: "var(--crit-bg, #2e0a0a)", border: "var(--crit)", icon: "✕" },
  info: { bg: "var(--bg-elevated)", border: "var(--border-strong)", icon: "ℹ" },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<Toast[]>([]);
  const seq = React.useRef(1);
  // Auto-dismiss timer per toast id, so manual dismiss can cancel it.
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = React.useCallback(
    (message: string, kind: ToastKind = "info", href?: string) => {
      const id = seq.current++;
      setItems((prev) => [...prev, { id, kind, message, href }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 4000),
      );
    },
    [dismiss],
  );

  // Clear any pending timers on unmount.
  React.useEffect(() => () => {
    timers.current.forEach((t) => clearTimeout(t));
    timers.current.clear();
  }, []);

  const api = React.useMemo<ToastApi>(
    () => ({
      toast: (m, k, opts) => push(m, k, opts?.href),
      success: (m, opts) => push(m, "success", opts?.href),
      error: (m, opts) => push(m, "error", opts?.href),
      info: (m, opts) => push(m, "info", opts?.href),
    }),
    [push],
  );

  // Expose this provider's pusher to the module-level `notify` bridge.
  React.useEffect(() => {
    activePusher = push;
    return () => {
      if (activePusher === push) activePusher = null;
    };
  }, [push]);

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          maxWidth: 380,
        }}
        role="status"
        aria-live="polite"
      >
        {items.map((t) => {
          const c = COLORS[t.kind];
          return (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                borderRadius: 9,
                background: c.bg,
                border: `1px solid ${c.border}`,
                color: "var(--text-primary)",
                fontSize: 14,
                boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
                animation: "ddToastIn .16s ease-out",
              }}
            >
              <span style={{ color: c.border, fontWeight: 700 }}>{c.icon}</span>
              <span style={{ flex: 1 }}>
                {t.href ? (
                  <a
                    href={t.href}
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    {t.message}
                  </a>
                ) : (
                  t.message
                )}
              </span>
              <button
                onClick={() => dismiss(t.id)}
                style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
