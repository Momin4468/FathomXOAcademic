"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Textarea } from "./ui";

/**
 * Imperative confirm dialog (UI_AUDIT R3). A single <ConfirmProvider> mounts at the
 * app root (like ToastProvider); any client component calls
 * `const confirm = useConfirm()` then `await confirm({...})`. Returns `false` when
 * cancelled, `true` when confirmed. With `reasonField`, it returns the entered
 * string on confirm (so reversals capture a reason) — check `=== false` to detect
 * cancel (an empty-but-confirmed reason is a valid ""). Replaces window.confirm/
 * prompt and gates every destructive/irreversible action.
 */
interface ConfirmOpts {
  title: string;
  body?: ReactNode;
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  reasonField?: { label: string; required?: boolean; placeholder?: string };
}
type ConfirmResult = boolean | string;
interface ConfirmApi {
  confirm: (o: ConfirmOpts) => Promise<ConfirmResult>;
}

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);

  // Capture the trigger on open; restore focus to it on close (focus return).
  useEffect(() => {
    if (opts) prevFocus.current = document.activeElement as HTMLElement | null;
    else prevFocus.current?.focus?.();
  }, [opts]);

  // Trap Tab within the dialog while it's open.
  const onKeyDownTrap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'button, input, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const confirm = useCallback(
    (o: ConfirmOpts) =>
      new Promise<ConfirmResult>((resolve) => {
        setOpts(o);
        setReason("");
        setTouched(false);
        resolver.current = resolve;
      }),
    [],
  );

  const settle = (result: ConfirmResult) => {
    resolver.current?.(result);
    resolver.current = null;
    setOpts(null);
  };
  const onCancel = () => settle(false);
  const onConfirm = () => {
    if (opts?.reasonField?.required && !reason.trim()) {
      setTouched(true);
      return;
    }
    settle(opts?.reasonField ? reason : true);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {opts && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={opts.title}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && !opts.reasonField) onConfirm();
            onKeyDownTrap(e);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <button type="button" aria-hidden tabIndex={-1} onClick={onCancel} className="absolute inset-0 cursor-default bg-black/50" />
          <div ref={panelRef} className="relative w-full max-w-sm rounded-xl border border-ink-700 bg-ink-850 p-5 shadow-lg">
            <h2 className="text-sm font-semibold text-slate-100">{opts.title}</h2>
            {opts.body && <div className="mt-1 text-sm text-slate-300">{opts.body}</div>}
            {opts.reasonField && (
              <div className="mt-3">
                <label htmlFor="confirm-reason" className="text-xs text-slate-400">{opts.reasonField.label}</label>
                <Textarea
                  id="confirm-reason"
                  autoFocus
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={opts.reasonField.placeholder}
                  aria-invalid={touched && opts.reasonField.required && !reason.trim() ? true : undefined}
                  aria-describedby={touched && opts.reasonField.required && !reason.trim() ? "confirm-reason-err" : undefined}
                  className="mt-1"
                />
                {touched && opts.reasonField.required && !reason.trim() && (
                  <span id="confirm-reason-err" className="mt-1 block text-xs text-red-400">A reason is required.</span>
                )}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={onCancel}>{opts.cancelLabel ?? "Cancel"}</Button>
              <Button autoFocus={!opts.reasonField} variant={opts.danger ? "danger" : "primary"} onClick={onConfirm}>
                {opts.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi["confirm"] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx.confirm;
}
