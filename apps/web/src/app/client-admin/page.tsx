"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { can, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Spinner, cx } from "@/components/ui";

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
        <h1 className="mb-3 text-lg font-semibold tracking-tight">Client portal</h1>
        <EmptyState title="No access" hint="You don’t have permission to manage client portal logins." />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Client portal</h1>
      <Provision />
      <Accounts />
      <Messages />
    </AppShell>
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

  async function provision(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId || !loginId.trim() || !password) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await apiSend("client-portal/accounts", "POST", { partyId, loginId: loginId.trim(), password });
      setMsg(`Login created for ${loginId.trim()}.`);
      setLoginId("");
      setPassword("");
      setPartyId(null);
      setResetSeq((n) => n + 1);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not provision login");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Give a client a portal login</p>
      <form onSubmit={provision} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Client">
          <EntityPicker key={resetSeq} placeholder="Search client…" search={searchClients} onPick={(i) => setPartyId(i?.id ?? null)} />
        </Field>
        <Field label="Login ID (client/student id or email)">
          <Input value={loginId} onChange={(e) => setLoginId(e.target.value)} />
        </Field>
        <Field label="Temporary password">
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={busy || !partyId || !loginId.trim() || !password}>
            {busy ? "Creating…" : "Create login"}
          </Button>
        </div>
        <div className="sm:col-span-2">
          {err && <ErrorNote message={err} />}
          {msg && <p className="text-xs text-green-700">{msg}</p>}
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
    <section className="mb-8">
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Logins</h2>
      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {accounts && accounts.length === 0 && <EmptyState title="No client logins yet" hint="Create one above." />}
      {accounts && accounts.length > 0 && (
        <div className="space-y-2">
          {accounts.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{a.partyName ?? a.partyId}</span>
                  <span className="text-xs text-gray-400">{a.loginId}</span>
                  <Badge tone={a.status === "active" ? "green" : a.status === "deactivated" ? "red" : "gray"}>{a.status}</Badge>
                </div>
                <Button
                  variant="ghost"
                  className="px-2 text-xs"
                  onClick={() => setStatus(a.id, a.status === "deactivated" ? "active" : "deactivated")}
                >
                  {a.status === "deactivated" ? "Reactivate" : "Deactivate"}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
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
    <section>
      <h2 className="mb-2 text-sm font-semibold text-gray-700">Client messages</h2>
      <Card>
        <Field label="Client">
          <EntityPicker placeholder="Search client…" search={searchClients} onPick={(i) => setPartyId(i?.id ?? null)} />
        </Field>
        {partyId && (
          <>
            <div className="my-3 space-y-2">
              {(thread ?? []).map((m) => (
                <div key={m.id} className={cx("flex", m.sender === "admin" ? "justify-end" : "justify-start")}>
                  <div
                    className={cx(
                      "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                      m.sender === "admin" ? "bg-gray-800 text-white" : "bg-gray-50 text-gray-800 ring-1 ring-gray-100",
                    )}
                  >
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    <p className="mt-1 text-[10px] opacity-70">{formatDateTime(m.createdAt)}</p>
                  </div>
                </div>
              ))}
              {thread && thread.length === 0 && <p className="text-xs text-gray-400">No messages with this client yet.</p>}
            </div>
            <form onSubmit={reply} className="flex gap-2">
              <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Reply…" />
              <Button type="submit" disabled={busy || !body.trim()}>Send</Button>
            </form>
            {err && <div className="mt-2"><ErrorNote message={err} /></div>}
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-gray-400">
        Client-submitted requests appear as drafts in <a className="underline" href="/work">Work</a> — confirm and price them there.
      </p>
    </section>
  );
}
