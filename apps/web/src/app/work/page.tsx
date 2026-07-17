"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { apiSend, useApi } from "@/lib/api";
import { can, type WhoAmI, type WorkListRow } from "@/lib/types";
import { AppShell } from "@/components/AppShell";

/**
 * Tasks — the operational core, recreated to the `Business OS v5` design handoff
 * (capture-first "Log a task" bar + a dense, role-tiered grid with the owner's
 * warm parchment private columns). Wired to the real read-model: rows come from
 * GET /work (money-gated + opacity-safe per the caller), state changes post a
 * transition, the client price edits the consumer line, and "Generate invoice"
 * bills the selected client. Styling uses the handoff's exact tokens.
 */

// ── design tokens (exact from design_handoff_business_os/README.md) ──────────
const T = {
  gold: "#E8B64C", goldHover: "#F0D08C", goldDeep: "#B6822A",
  ink: "#0E1524", ink2: "#45506A", muted: "#667085", muted2: "#8A93A6",
  card: "#FFFFFF", border: "#E2E6EC", hair: "#F3F5F8", eyebrow: "#EEF1F5", rowHover: "#FAFBFC",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  codeBg: "#EEF1F5", codeText: "#26304A",
  parch: "#FBF7EC", parchIn: "#FFFDF6", parchBorder: "#EAD9AE", parchText: "#8A5F1D",
  green: "#157F3D", greenBg: "#E4F3EA", red: "#B42318", redBg: "#FBE9E7",
  amber: "#8A5F1D", amberBg: "#FCF6E8", blue: "#3353C4", purple: "#6D3FC4",
};
const inputBase: React.CSSProperties = {
  border: `1px solid ${T.border}`, borderRadius: 7, padding: "8px 9px",
  fontSize: 12.5, fontFamily: "Inter, sans-serif", outlineColor: T.gold, background: T.card,
};
const bdt = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return `৳${v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};
const fmtDue = (d?: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-");
  return day && m ? `${day}/${m}` : d;
};
const toIso = (ddmmyyyy: string): string | undefined => {
  const m = ddmmyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return undefined;
  const [, d, mo, y] = m;
  const yy = y.length === 2 ? `20${y}` : y;
  return `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

export default function TasksPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const perms = me?.permissions;
  const canBill = can(perms, "work:approve"); // admins/owner: client price + margin
  const canInvoice = can(perms, "billing:create");
  const isOwner = !!me?.principal?.isSystemSuperadmin || canBill; // sees the parchment "actual / your extra"
  const { data: rows, mutate } = useApi<WorkListRow[]>("work");

  const pending = useMemo(() => (rows ?? []).filter((r) => r.workState !== "delivered"), [rows]);
  const done = useMemo(() => (rows ?? []).filter((r) => r.workState === "delivered"), [rows]);

  const sub = canBill
    ? "writers log; you add client price, vendor, invoice, paid — the owner also sees the real price"
    : "your work log — your own fee, no client price";

  return (
    <AppShell>
      <div style={{ fontFamily: "Inter, sans-serif", color: T.ink }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 14 }}>
          <h1 style={{ fontFamily: "Fraunces, Georgia, serif", fontSize: 24, fontWeight: 600, margin: 0 }}>Tasks</h1>
          <span style={{ fontSize: 12.5, color: T.muted }}>{sub}</span>
          <div style={{ flex: 1 }} />
          {canInvoice && (
            <Link href="/invoices" style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 14px", borderRadius: 8, background: T.card, color: T.ink2, border: `1px solid ${T.border}`, textDecoration: "none" }}>
              Generate invoice
            </Link>
          )}
        </div>

        <LogBar canBill={canBill} onLogged={() => void mutate()} />

        <TaskTable
          title="Task pending"
          rows={pending}
          canBill={canBill}
          isOwner={isOwner}
          headerBg={T.amberBg}
          headerColor={T.amber}
          onChanged={() => void mutate()}
        />
        {done.length > 0 && (
          <TaskTable
            title="Done"
            rows={done}
            canBill={canBill}
            isOwner={isOwner}
            headerBg={T.card}
            headerColor={T.green}
            onChanged={() => void mutate()}
            done
          />
        )}
        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 10 }}>
          Course code is the only required field. Everything else is capture-first — complete it later. Money is derived from the legs; a writer never sees a client price.
        </div>
      </div>
    </AppShell>
  );
}

/** Capture-first entry card: "Log a task" (inline) + "Add course / thesis / project". */
function LogBar({ canBill, onLogged }: { canBill: boolean; onLogged: () => void }) {
  const [code, setCode] = useState("");
  const [uni, setUni] = useState("");
  const [course, setCourse] = useState("");
  const [client, setClient] = useState("");
  const [from, setFrom] = useState("");
  const [detail, setDetail] = useState("");
  const [copies, setCopies] = useState("");
  const [words, setWords] = useState("");
  const [due, setDue] = useState("");
  const [fee, setFee] = useState("");
  const [group, setGroup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pill = (active: boolean): React.CSSProperties => ({
    fontSize: 12, fontWeight: 700, padding: "4px 12px", borderRadius: 999, cursor: "pointer",
    background: active ? T.ink : "transparent", color: active ? "#F0D08C" : T.muted,
  });

  async function save() {
    if (!code.trim() && !detail.trim()) {
      setErr("Enter a course code (or a detail) to log the task.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const noteBits = [
        code.trim() && `Code ${code.trim()}`,
        uni.trim() && `Uni ${uni.trim()}`,
        course.trim() && `Course ${course.trim()}`,
        client.trim() && `Client ${client.trim()}`,
        from.trim() && `From ${from.trim()}`,
        copies.trim() && `Copies ${copies.trim()}`,
        fee.trim() && `Writer fee ${fee.trim()}`,
      ].filter(Boolean).join(" · ");
      await apiSend("work", "POST", {
        title: (detail.trim() || code.trim() || "New task").slice(0, 300),
        moduleName: course.trim() || undefined,
        wordCount: words.trim() ? Number(words.trim().replace(/[^\d]/g, "")) : undefined,
        deliveryDate: toIso(due),
        groupKind: group ? "group" : "individual",
        notes: noteBits || undefined,
      });
      setCode(""); setUni(""); setCourse(""); setClient(""); setFrom(""); setDetail("");
      setCopies(""); setWords(""); setDue(""); setFee("");
      onLogged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not log the task");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderBottom: `1px solid ${T.eyebrow}` }}>
        <span style={pill(true)}>Log a task</span>
        <Link href="/work/bundle" style={{ ...pill(false), textDecoration: "none" }}>Add course / thesis / project</Link>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: T.muted2 }}>course code is the only required field</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))", gap: 8, padding: "12px 14px", alignItems: "center" }}>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code *" style={{ ...inputBase, border: `1.5px solid ${code ? T.gold : T.border}`, fontFamily: T.mono, fontWeight: 600, textTransform: "uppercase" }} />
        <input value={uni} onChange={(e) => setUni(e.target.value)} placeholder="University" style={inputBase} />
        <input value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Course name" style={inputBase} />
        <input value={client} onChange={(e) => setClient(e.target.value)} placeholder="Client (if known)" style={inputBase} />
        <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="From — Emon / Momin…" style={inputBase} />
        <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Detail — A1, A2…" style={inputBase} />
        <input value={copies} onChange={(e) => setCopies(e.target.value)} placeholder="Copies" style={{ ...inputBase, textAlign: "right" }} />
        <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="Words" style={{ ...inputBase, textAlign: "right" }} />
        <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="Deadline dd/mm/yyyy" style={{ ...inputBase, color: T.ink2 }} />
        <input value={fee} onChange={(e) => setFee(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="৳ writer fee" style={{ ...inputBase, textAlign: "right" }} />
        <span onClick={() => !busy && save()} style={{ background: T.gold, color: "#070A14", fontWeight: 700, fontSize: 12.5, padding: "8px 14px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", textAlign: "center", opacity: busy ? 0.6 : 1 }}>
          {busy ? "…" : "Log ↵"}
        </span>
      </div>
      <div style={{ padding: "0 14px 10px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: T.muted }}>Submission:</span>
        {(["individual", "group"] as const).map((k) => {
          const active = (k === "group") === group;
          return (
            <span key={k} onClick={() => setGroup(k === "group")} style={{ fontSize: 11.5, fontWeight: 700, padding: "4px 12px", borderRadius: 999, cursor: "pointer", background: active ? T.ink : "transparent", color: active ? "#F0D08C" : T.muted, border: `1px solid ${active ? T.ink : T.border}`, textTransform: "capitalize" }}>
              {k}
            </span>
          );
        })}
        {canBill && <Link href="/work/new" style={{ fontSize: 11.5, fontWeight: 600, color: T.goldDeep, marginLeft: 6, textDecoration: "none" }}>+ discount / optional fields (full form) →</Link>}
      </div>
      {err && <div style={{ padding: "0 14px 10px", fontSize: 11.5, color: T.red, fontWeight: 600 }}>{err}</div>}
    </div>
  );
}

/** The dense role-tiered task grid (matches the handoff column set + parchment cols). */
function TaskTable({
  title, rows, canBill, isOwner, headerBg, headerColor, onChanged, done,
}: {
  title: string; rows: WorkListRow[]; canBill: boolean; isOwner: boolean;
  headerBg: string; headerColor: string; onChanged: () => void; done?: boolean;
}) {
  const th: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
    color: T.muted, padding: "8px 10px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap",
  };
  const thR = { ...th, textAlign: "right" as const };
  const thParch = { ...thR, background: T.parch, color: T.parchText };
  const td: React.CSSProperties = { padding: "7px 10px", borderBottom: `1px solid ${T.hair}` };
  const tdR = { ...td, textAlign: "right" as const, fontVariantNumeric: "tabular-nums" as const };

  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, overflowX: "auto", marginBottom: 14 }}>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.eyebrow}`, background: headerBg, fontSize: 12, fontWeight: 700, color: headerColor }}>
        {title} · {rows.length}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr>
            <th style={th}>Code</th>
            <th style={{ ...th, textAlign: "left" }}>Task</th>
            <th style={{ ...th, textAlign: "left" }}>Client</th>
            <th style={{ ...th, textAlign: "left" }}>From</th>
            <th style={thR}>Copies</th>
            <th style={thR}>Words</th>
            <th style={th}>Deadline</th>
            <th style={thR}>Writer ↓</th>
            {canBill && <th style={thR}>Client ↓</th>}
            {canBill && <th style={thR}>Margin</th>}
            {isOwner && <th style={thParch}>Actual ↓ (private)</th>}
            {isOwner && <th style={thParch}>Your extra</th>}
            <th style={{ ...th, textAlign: "center" }}>State</th>
            <th style={th} />
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={14} style={{ ...td, textAlign: "center", color: T.muted2, padding: "18px 10px" }}>Nothing here yet.</td></tr>
          ) : rows.map((r) => (
            <TaskRow key={r.id} r={r} canBill={canBill} isOwner={isOwner} td={td} tdR={tdR} onChanged={onChanged} done={done} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TaskRow({
  r, canBill, isOwner, td, tdR, onChanged, done,
}: {
  r: WorkListRow; canBill: boolean; isOwner: boolean;
  td: React.CSSProperties; tdR: React.CSSProperties; onChanged: () => void; done?: boolean;
}) {
  const writerVal = canBill ? r.writerAmount : r.myFee;
  const NEXT: Record<string, string | undefined> = { draft: "pending", pending: "confirmed", confirmed: "delivered" };
  const next = NEXT[r.workState];

  async function advance() {
    if (!next) return;
    try {
      await apiSend(`work/${r.id}/transition`, "POST", { toState: next });
      onChanged();
    } catch { /* surfaced on reload */ }
  }

  const stateChip = (s: string) => {
    const map: Record<string, [string, string]> = {
      draft: ["#EEF1F5", T.muted], pending: ["#FCF6E8", T.amber],
      confirmed: ["#E8EDFB", T.blue], delivered: [T.greenBg, T.green],
    };
    const [bg, color] = map[s] ?? ["#EEF1F5", T.muted];
    return <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: bg, color }}>{s}</span>;
  };

  return (
    <tr style={{ background: done ? T.rowHover : undefined }}>
      <td style={{ ...td, fontFamily: T.mono, fontSize: 11.5, fontWeight: 600, color: T.codeText, whiteSpace: "nowrap" }}>{r.courseCode ?? "—"}</td>
      <td style={td}>
        <Link href={`/work/${r.id}`} style={{ display: "block", color: T.ink, fontWeight: 500, textDecoration: "none" }}>{r.title}</Link>
        {(r.projectTitle || r.courseCode) && <span style={{ display: "block", fontSize: 10.5, color: T.muted2 }}>{r.projectTitle ?? r.courseCode}</span>}
      </td>
      <td style={{ ...td, color: T.ink2 }}>{r.clientName ?? "—"}</td>
      <td style={{ ...td, color: T.ink2 }}>{r.ownerName ?? "—"}</td>
      <td style={tdR}>{r.copies ?? "—"}</td>
      <td style={tdR}>{r.wordCount ?? "—"}</td>
      <td style={{ ...td, fontSize: 11.5, color: T.muted2, whiteSpace: "nowrap" }}>{fmtDue(r.deliveryDate ?? r.submissionDate)}</td>
      <td style={{ ...tdR, fontWeight: 600 }}>{writerVal != null ? bdt(writerVal) : "—"}</td>
      {canBill && <td style={{ ...tdR, fontWeight: 600 }}>{r.clientAmount != null ? bdt(r.clientAmount) : "—"}</td>}
      {canBill && <td style={{ ...tdR, fontWeight: 600, color: (r.margin ?? 0) < 0 ? T.red : T.ink }}>{r.margin != null ? bdt(r.margin) : "—"}</td>}
      {isOwner && <td style={{ ...tdR, background: T.parch }}>{r.clientAmount != null ? bdt(r.clientAmount) : "—"}</td>}
      {isOwner && <td style={{ ...tdR, background: T.parch, fontWeight: 700, color: T.parchText }}>{r.margin != null ? bdt(r.margin) : "—"}</td>}
      <td style={{ ...td, textAlign: "center" }}>{stateChip(r.workState)}</td>
      <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
        {next && (
          <span onClick={advance} title={`Mark ${next}`} style={{ fontSize: 11, fontWeight: 600, color: T.goldDeep, cursor: "pointer", marginRight: 8 }}>→ {next}</span>
        )}
        <Link href={`/work/${r.id}`} style={{ fontSize: 11, fontWeight: 600, color: T.muted, textDecoration: "none" }}>open</Link>
      </td>
    </tr>
  );
}
