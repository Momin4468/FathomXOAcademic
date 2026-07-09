"use client";
import { useState } from "react";
import { clientApiSend, useClientApi } from "@/lib/client-api";
import { formatDateTime } from "@/lib/format";
import { ClientPortalShell } from "@/components/ClientPortalShell";
import { Button, Card, EmptyState, ErrorNote, Input, Spinner, cx } from "@/components/ui";

interface Message {
  id: string;
  body: string;
  sender: "client" | "admin";
  createdAt: string;
}
interface Config {
  whatsappUrl: string | null;
}

export default function MessagesPage() {
  const { data: messages, error, isLoading, mutate } = useClientApi<Message[]>("messages");
  const { data: config } = useClientApi<Config>("config");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setErr("");
    try {
      await clientApiSend("messages", "POST", { body: body.trim() });
      setBody("");
      await mutate();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ClientPortalShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Messages</h1>
        {config?.whatsappUrl && (
          <a href={config.whatsappUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="secondary">Message us on WhatsApp</Button>
          </a>
        )}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {messages && messages.length === 0 && (
        <EmptyState title="No messages yet" hint="Send us a message and we’ll reply here." />
      )}
      {messages && messages.length > 0 && (
        <ul className="mb-4 max-h-[60vh] space-y-2 overflow-y-auto">
          {messages.map((m) => (
            <li key={m.id} className={cx("flex", m.sender === "client" ? "justify-end" : "justify-start")}>
              <div
                className={cx(
                  "max-w-[80%] rounded-2xl px-3 py-2 text-sm",
                  m.sender === "client" ? "bg-sky-600 text-white" : "bg-white text-gray-800 ring-1 ring-gray-100",
                )}
              >
                <p className="whitespace-pre-wrap">{m.body}</p>
                <p className={cx("mt-1 text-[10px]", m.sender === "client" ? "text-sky-100" : "text-gray-400")}>
                  {formatDateTime(m.createdAt)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Card>
        <form onSubmit={send} className="flex gap-2">
          <Input aria-label="Write a message" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a message…" />
          <Button type="submit" disabled={busy || !body.trim()}>Send</Button>
        </form>
        {err && <div className="mt-2"><ErrorNote message={err} /></div>}
      </Card>
    </ClientPortalShell>
  );
}
