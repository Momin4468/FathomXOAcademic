"use client";
import Link from "next/link";
import { useMemo } from "react";
import { apiSend, useApi } from "@/lib/api";
import { type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Card, fmtDay, money, Page, T } from "@/components/dc";

/**
 * Pending (handoff §2) — the lightweight "what's still open" whiteboard: every
 * task not yet delivered, as a scannable list (code · detail · who · due · advance),
 * recreated to the Business OS v5 design.
 */
export default function PendingPage() {
  const { data: rows, mutate } = useApi<WorkListRow[]>("work");
  const open = useMemo(
    () => (rows ?? [])
      .filter((r) => r.workState !== "delivered")
      .sort((a, b) => (a.deliveryDate ?? a.submissionDate ?? "~").localeCompare(b.deliveryDate ?? b.submissionDate ?? "~")),
    [rows],
  );

  async function advance(id: string, state: string) {
    const order = ["draft", "pending", "confirmed", "delivered"];
    const next = order[order.indexOf(state) + 1];
    if (!next) return;
    try { await apiSend(`work/${id}/transition`, "POST", { toState: next }); mutate(); } catch { /* surfaced on reload */ }
  }

  return (
    <AppShell>
      <Page title="Pending" sub="what's still open — the whiteboard, just the essentials">
        <Card>
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.eyebrow}`, fontSize: 12, fontWeight: 700, color: T.amber }}>Open · {open.length}</div>
          {open.length === 0 ? (
            <div style={{ padding: "22px 14px", fontSize: 12.5, color: T.muted2 }}>Nothing open — all delivered.</div>
          ) : open.map((d) => {
            const due = d.deliveryDate ?? d.submissionDate ?? null;
            const soon = !!due && due <= new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
            return (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: `1px solid ${T.hair}` }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: T.mono, background: T.codeBg, color: T.codeText, borderRadius: 6, padding: "3px 7px" }}>{d.courseCode ?? "—"}</span>
                <Link href={`/work/${d.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: T.ink }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{d.title}</span>
                  <span style={{ display: "block", fontSize: 11, color: T.muted2 }}>{d.clientName ?? d.ownerName ?? "—"} · {d.workState}{d.myFee != null ? ` · ${money(d.myFee)}` : ""}</span>
                </Link>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: soon ? T.red : T.muted, whiteSpace: "nowrap", minWidth: 74, textAlign: "right" }}>{fmtDay(due)}</span>
                <span onClick={() => advance(d.id, d.workState)} style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 10px", borderRadius: 999, cursor: "pointer", background: T.amberBg2, color: T.amber }}>advance →</span>
              </div>
            );
          })}
        </Card>
      </Page>
    </AppShell>
  );
}
