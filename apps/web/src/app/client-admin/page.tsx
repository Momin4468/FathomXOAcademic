"use client";
import type { CSSProperties } from "react";
import { useState } from "react";
import Link from "next/link";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDateTime } from "@/lib/format";
import { can, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Badge, Card, CardHead, cell, DGrid, dcInput, EmptyBox, Field, GhostButton, GoldButton, Loading, Note, Page, T } from "@/components/dc";

interface ClientAccountRow {
  id: string;
  partyId: string;
  partyName: string | null;
  loginId: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
}
interface AdminMessage {
  id: string;
  body: string;
  sender: "client" | "admin";
  createdAt: string;
}

const sectionH: CSSProperties = { fontFamily: "Fraunces, Georgia, serif", fontSize: 15, fontWeight: 600, color: T.ink, margin: "22px 0 10px" };
const okMsg: CSSProperties = { margin: 0, fontSize: 11.5, fontWeight: 600, color: T.green };

const searchClients = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=client`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.externalRef ?? undefined }));
};

export default function ClientAdminPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const canManage = can(me?.permissions, "client_portal:view");

  if (me && !canManage) {
    return (
      <AppShell>
        <Page title="Client portal">
          <EmptyBox title="No access" hint="You don’t have permission to manage client portal logins." />
        </Page>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Page title="Client portal" sub="provision portal logins and reply to client messages">
        <AutoProvision />
        <Provision />
        <Accounts />
        <Messages />
      </Page>
    </AppShell>
  );
}

/** Auto-provision a login from a student ID + name; shows the derived initial password once. */
function AutoProvision() {
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ loginId: string; initialPassword: string } | null>(null);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!studentId.trim() || !name.trim()) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    setResult(null);
    try {
      const res = await apiSend<{ loginId: string; initialPassword: string }>("client-portal/accounts/auto", "POST", {
        studentId: studentId.trim(),
        name: name.trim(),
      });
      setResult({ loginId: res.loginId, initialPassword: res.initialPassword });
      setStudentId("");
      setName("");
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not auto-provision") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Auto-provision from student ID + name</CardHead>
      <form onSubmit={run} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Student ID" error={fieldErrs.studentId}>
          <input value={studentId} onChange={(e) => setStudentId(e.target.value)} placeholder="e.g. ICT-701" style={dcInput} />
        </Field>
        <Field label="Name" error={fieldErrs.name}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={dcInput} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <GhostButton type="submit" disabled={busy || !studentId.trim() || !name.trim()}>{busy ? "Creating…" : "Auto-provision"}</GhostButton>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          {err && <Note>{err}</Note>}
          {result && (
            <Note tone="green">
              <div style={{ fontWeight: 700 }}>Login created — hand these over now (shown once):</div>
              <div style={{ fontFamily: T.mono, fontSize: 11.5, marginTop: 4 }}>Login: {result.loginId}<br />Temporary password: {result.initialPassword}</div>
              <div style={{ fontSize: 10.5, marginTop: 4 }}>The client must reset this password on first login.</div>
            </Note>
          )}
        </div>
      </form>
    </Card>
  );
}

function Provision() {
  const [partyId, setPartyId] = useState<string | null>(null);
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [resetSeq, setResetSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function provision(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId || !loginId.trim() || !password) return;
    setBusy(true);
    setErr("");
    setMsg("");
    setFieldErrs({});
    try {
      await apiSend("client-portal/accounts", "POST", { partyId, loginId: loginId.trim(), password });
      setMsg(`Login created for ${loginId.trim()}.`);
      setLoginId("");
      setPassword("");
      setPartyId(null);
      setResetSeq((n) => n + 1);
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not provision login") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Give a client a portal login</CardHead>
      <form onSubmit={provision} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Client" error={fieldErrs.partyId}>
          <EntityPicker key={resetSeq} placeholder="Search client…" search={searchClients} onPick={(i) => setPartyId(i?.id ?? null)} />
        </Field>
        <Field label="Login ID (client/student id or email)" error={fieldErrs.loginId}>
          <input value={loginId} onChange={(e) => setLoginId(e.target.value)} style={dcInput} />
        </Field>
        <Field label="Temporary password" error={fieldErrs.password}>
          <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} style={dcInput} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <GhostButton type="submit" disabled={busy || !partyId || !loginId.trim() || !password}>{busy ? "Creating…" : "Create login"}</GhostButton>
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          {err && <Note>{err}</Note>}
          {msg && <p style={okMsg}>{msg}</p>}
        </div>
      </form>
    </Card>
  );
}

function Accounts() {
  const { data: accounts, error, isLoading, mutate } = useApi<ClientAccountRow[]>("client-portal/accounts");

  async function setStatus(id: string, status: string) {
    await apiSend(`client-portal/accounts/${id}`, "PATCH", { status });
    await mutate();
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <h2 style={sectionH}>Logins</h2>
      {isLoading && <Loading />}
      {error && <Note>{error.message}</Note>}
      {accounts && (
        <DGrid<ClientAccountRow>
          minWidth={420}
          rows={accounts}
          keyOf={(a) => a.id}
          cols={[
            { label: "Client", render: (a) => cell(a.partyName ?? a.partyId, { weight: 500, sub: a.loginId }) },
            { label: "Status", align: "center", render: (a) => <Badge tone={a.status === "active" ? "green" : a.status === "deactivated" ? "red" : "gray"}>{a.status}</Badge> },
            {
              label: "",
              align: "right",
              render: (a) => (
                <GhostButton onClick={() => void setStatus(a.id, a.status === "deactivated" ? "active" : "deactivated")}>
                  {a.status === "deactivated" ? "Reactivate" : "Deactivate"}
                </GhostButton>
              ),
            },
          ]}
          empty="No client logins yet — create one above."
        />
      )}
    </div>
  );
}

function Messages() {
  const [partyId, setPartyId] = useState<string | null>(null);
  const { data: thread, mutate } = useApi<AdminMessage[]>(partyId ? `client-portal/messages?partyId=${partyId}` : null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function reply(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId || !body.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("client-portal/messages", "POST", { partyId, body: body.trim() });
      setBody("");
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 style={sectionH}>Client messages</h2>
      <Card>
        <div style={{ padding: 14 }}>
          <Field label="Client">
            <EntityPicker placeholder="Search client…" search={searchClients} onPick={(i) => setPartyId(i?.id ?? null)} />
          </Field>
          {partyId && (
            <>
              <div style={{ margin: "14px 0", display: "grid", gap: 8 }}>
                {(thread ?? []).map((m) => (
                  <div key={m.id} style={{ display: "flex", justifyContent: m.sender === "admin" ? "flex-end" : "flex-start" }}>
                    <div
                      style={{
                        maxWidth: "80%",
                        borderRadius: 12,
                        padding: "8px 11px",
                        fontSize: 12.5,
                        background: m.sender === "admin" ? T.ink : T.hair,
                        color: m.sender === "admin" ? "#FFFFFF" : T.ink,
                        border: m.sender === "admin" ? "none" : `1px solid ${T.border}`,
                      }}
                    >
                      <div style={{ whiteSpace: "pre-wrap" }}>{m.body}</div>
                      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>{formatDateTime(m.createdAt)}</div>
                    </div>
                  </div>
                ))}
                {thread && thread.length === 0 && <p style={{ margin: 0, fontSize: 11.5, color: T.muted }}>No messages with this client yet.</p>}
              </div>
              <form onSubmit={reply} style={{ display: "flex", gap: 10 }}>
                <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply…" style={{ ...dcInput, flex: 1 }} />
                <GoldButton type="submit" disabled={busy || !body.trim()}>Send</GoldButton>
              </form>
              {err && <div style={{ marginTop: 10 }}><Note>{err}</Note></div>}
            </>
          )}
        </div>
      </Card>
      <p style={{ marginTop: 12, fontSize: 11.5, color: T.muted }}>
        Client-submitted requests appear as drafts in{" "}
        <Link href="/work" style={{ color: T.goldDeep, fontWeight: 600, textDecoration: "none" }}>Work</Link> — confirm and price them there.
      </p>
    </div>
  );
}
