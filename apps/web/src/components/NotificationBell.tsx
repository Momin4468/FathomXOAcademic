"use client";
import { useEffect, useRef, useState } from "react";
import { useSWRConfig } from "swr";
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
        className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-gray-600 hover:text-gray-900"
      >
        <span aria-hidden className="text-lg leading-none">🔔</span>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* click-away backdrop */}
          <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              {unread > 0 && (
                <button type="button" onClick={markAll} className="text-xs text-gray-500 hover:text-gray-900">
                  Mark all read
                </button>
              )}
            </div>

            {canBroadcast && <BroadcastComposer onSent={refresh} />}

            <div className="max-h-80 overflow-y-auto">
              {rowsError ? (
                <p className="px-3 py-4 text-xs text-red-600">Couldn't load notifications.</p>
              ) : !rows ? (
                <p className="px-3 py-4 text-xs text-gray-500">Loading…</p>
              ) : rows.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-gray-500">You're all caught up.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {rows.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => n.readAt === null && markRead(n.id)}
                        className={cx("flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-50", n.readAt === null && "bg-blue-50/40")}
                      >
                        <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt === null ? "bg-blue-600" : "bg-transparent")} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900">{n.title}</span>
                          {n.body && <span className="mt-0.5 block break-words text-xs text-gray-600">{n.body}</span>}
                          <span className="mt-0.5 block text-[11px] text-gray-400">{formatDateTime(n.createdAt)}</span>
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
    <div className="space-y-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Broadcast to everyone</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        maxLength={200}
        className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:border-gray-400 focus:outline-none"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message (optional)"
        rows={2}
        maxLength={4000}
        className="w-full resize-none rounded border border-gray-200 px-2 py-1 text-sm focus:border-gray-400 focus:outline-none"
      />
      <div className="flex justify-end">
        <Button variant="secondary" className="px-2 py-1 text-xs" disabled={busy || !title.trim()} onClick={send}>
          {busy ? "Sending…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
