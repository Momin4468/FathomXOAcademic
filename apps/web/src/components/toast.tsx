"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "./ui";

/**
 * Hand-rolled toast surface (CLAUDE.md §2/§5: no exotic deps — like the PF SVG
 * charts). Closes UI_AUDIT R6 (no in-app success/error notice surface). A single
 * <ToastProvider> mounts once at the app root; any client component calls
 * `useToast().toast({...})`. Ephemeral, auto-dismissing, accessible (aria-live).
 */
type ToastVariant = "success" | "error" | "info";
interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}
interface ToastApi {
  toast: (t: { title: string; description?: string; variant?: ToastVariant }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE: Record<ToastVariant, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
  error: "border-red-200 bg-red-50 text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
  info: "border-ink-700 bg-ink-850 text-slate-100",
};

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const toast = useCallback<ToastApi["toast"]>(
    (t) => {
      const id = `toast-${++seq}`;
      setToasts((ts) => [...ts, { id, variant: "info", ...t }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            aria-live="polite"
            className={cx("pointer-events-auto w-full max-w-sm rounded-lg border px-4 py-3 shadow-md", TONE[t.variant])}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.title}</p>
                {t.description && <p className="mt-0.5 break-words text-xs opacity-80">{t.description}</p>}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 opacity-60 hover:opacity-100"
              >
                <X aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
