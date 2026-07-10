"use client";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
import { Bell } from "lucide-react";
import { apiSend, useApi } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Button, cx } from "./ui";
import { useToast } from "./toast";

interface NotificationRow {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Header bell (P1 item 7; closes UI_AUDIT R6's notice surface). Polls the unread
 * count every 30s, pops a toast when a new one arrives, and opens a self-scoped
 * panel to read/mark-read. Admins (notifications:approve) get a compact "notify
 * everyone" composer. All reads/writes go through the generic BFF proxy.
 */
export function NotificationBell({ canBroadcast }: { canBroadcast: boolean }) {
  const { mutate } = useSWRConfig();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { data: count } = useApi<{ unread: number }>("notifications/unread-count", { refreshInterval: 30000 });
  const { data: rows, error: rowsError } = useApi<NotificationRow[]>(open ? "notifications" : null);
  const unread = count?.unread ?? 0;

  // Toast when the unread count RISES (a new notification landed) — skip the first read.
  const prev = useRef<number | null>(null);
  useEffect(() => {
    if (prev.current !== null && unread > prev.current) {
      toast({ title: "New notification", description: `You have ${unread} unread.`, variant: "info" });
    }
    prev.current = unread;
  }, [unread, toast]);

  async function refresh() {
    await Promise.all([mutate("notifications"), mutate("notifications/unread-count")]);
  }
  async function markRead(id: string) {
    try {
      await apiSend(`notifications/${id}/read`, "POST");
      await refresh();
    } catch (e) {
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : "Please try again.", variant: "error" });
    }
  }
  async function markAll() {
    try {
      await apiSend("notifications/read-all", "POST");
      await refresh();
      toast({ title: "All caught up", description: "Marked everything read.", variant: "success" });
    } catch (e) {
      toast({ title: "Couldn't update", description: e instanceof Error ? e.message : "Please try again.", variant: "error" });
    }
  }

  return (
    <div className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        aria-expanded={open}
        className="relative flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-nav-text hover:bg-nav-hover hover:text-nav-bright"
      >
        <Bell aria-hidden className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-ink-700 bg-ink-850 shadow-lg">
            <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs text-slate-400 hover:text-slate-100">
                  Mark all read
                </button>
              )}
            </div>

            {canBroadcast && <BroadcastComposer onSent={refresh} />}

            <div className="max-h-80 overflow-y-auto">
              {rowsError ? (
                <p className="px-3 py-4 text-xs text-red-600 dark:text-red-400">Couldn't load notifications.</p>
              ) : !rows ? (
                <p className="px-3 py-4 text-xs text-slate-400">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-slate-400">You're all caught up.</p>
              ) : (
                <ul className="divide-y divide-ink-800">
                  {rows.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => n.readAt === null && markRead(n.id)}
                        className={cx("flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-ink-800", n.readAt === null && "bg-blue-500/10")}
                      >
                        <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt === null ? "bg-blue-400" : "bg-transparent")} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-slate-100">{n.title}</span>
                          {n.body && <span className="mt-0.5 block break-words text-xs text-slate-300">{n.body}</span>}
                          <span className="mt-0.5 block text-[11px] text-slate-500">{formatDateTime(n.createdAt)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Compact admin composer — broadcast to everyone in the org. */
function BroadcastComposer({ onSent }: { onSent: () => Promise<void> }) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const t = title.trim();
    if (!t) return;
    setBusy(true);
    try {
      const res = await apiSend<{ recipients: number }>("notifications/broadcast", "POST", { audienceKind: "all", title: t, body: body.trim() || undefined });
      setTitle("");
      setBody("");
      await onSent();
      toast({ title: "Broadcast sent", description: `Delivered to ${res.recipients} ${res.recipients === 1 ? "person" : "people"}.`, variant: "success" });
    } catch (e) {
      toast({ title: "Broadcast failed", description: e instanceof Error ? e.message : "Please try again.", variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 border-b border-ink-700 bg-ink-800 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Broadcast to everyone</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        maxLength={200}
        className="w-full rounded border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message (optional)"
        rows={2}
        maxLength={4000}
        className="w-full resize-none rounded border border-ink-700 bg-ink-850 px-2 py-1 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400"
      />
      <div className="flex justify-end">
        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={busy || !title.trim()} onClick={send}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
