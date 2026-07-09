"use client";
import { useEffect } from "react";
import { useConfirm } from "@/components/confirm";

/**
 * Unsaved-changes guard (UI_AUDIT R4; rubric "never lose the user's work"). While
 * `dirty`, warns on a hard navigation/tab-close/reload via `beforeunload`. For
 * in-app closes (a form toggle, a Cancel button, router.back), call the returned
 * `confirmClose(cb)` — when dirty it asks "Discard changes?" (reusing the R3
 * ConfirmDialog) and only runs `cb` if the user confirms. Next's App Router has no
 * stable route-abort API, so in-app protection is opt-in at each close handler.
 */
export function useUnsavedGuard(dirty: boolean) {
  const confirm = useConfirm();

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const confirmClose = async (cb: () => void) => {
    if (dirty) {
      const ok = await confirm({
        title: "Discard changes?",
        body: "Your entered changes will be lost.",
        danger: true,
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
      });
      if (!ok) return;
    }
    cb();
  };

  return { confirmClose };
}
