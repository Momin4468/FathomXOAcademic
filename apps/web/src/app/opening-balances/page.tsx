"use client";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { apiGet, apiSend, useApi } from "@/lib/api";
import type { PartyRow } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { PartyName } from "@/components/PartyName";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, CurrencySelect, EmptyState, ErrorNote, Field, Input, Money, MoneyInput, Select, Spinner } from "@/components/ui";

interface OpeningBalanceRow {
  id: string;
  partyId: string | null;
  amount: string;
  currency: string;
  asOf: string;
  note: string | null;
  reversesId: string | null;
}

const searchAnyParty = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: (p.partyType ?? []).join(", ") || undefined }));
};

/**
 * Opening balances (Phase 5) — a one-time, dated starting point per party (or the
 * business overall) that feeds the derived balance. A distinct, clearly-labeled
 * entry, never a fake backdated job/payment. Append-only (correct with a reversal).
 */
export default function OpeningBalancesPage() {
  const { mutate } = useSWRConfig();
  const confirm = useConfirm();
  const { data, error, isLoading } = useApi<OpeningBalanceRow[]>("opening-balances");

  const [scope, setScope] = useState<"party" | "business">("party");
  const [partyId, setPartyId] = useState<string | null>(null);
  const [direction, setDirection] = useState<"owed_to" | "owes_us">("owed_to");
  const [magnitude, setMagnitude] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [asOf, setAsOf] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const mag = Number(magnitude);
    if (!asOf || !(mag > 0) || (scope === "party" && !partyId)) return;
    setBusy(true);
    setFormError("");
    try {
      await apiSend("opening-balances", "POST", {
        partyId: scope === "party" ? partyId : undefined,
        amount: direction === "owes_us" ? -mag : mag,
        currency,
        asOf,
        note: note.trim() || undefined,
      });
      setMagnitude("");
      setNote("");
      setPartyId(null);
      await mutate("opening-balances");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  async function reverse(id: string) {
    if (!(await confirm({ title: "Reverse this opening balance?", body: "Posts a negating entry (append-only).", danger: true, confirmLabel: "Reverse" }))) return;
    await apiSend(`opening-balances/${id}/reverse`, "POST");
    await mutate("opening-balances");
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Opening balances</h1>
      <p className="mb-4 text-xs text-slate-400">
        A one-time starting point for a writer/party (or the business overall) as of a chosen date — distinct from a job or
        payment. From here, normal legs and payments carry the balance forward. Backdating is allowed.
      </p>

      <Card className="mb-5">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Applies to">
              <Select value={scope} onChange={(e) => setScope(e.target.value as "party" | "business")}>
                <option value="party">A specific party</option>
                <option value="business">The business overall</option>
              </Select>
            </Field>
            {scope === "party" && (
              <Field label="Party" required>
                <EntityPicker placeholder="Search any party…" search={searchAnyParty} onPick={(i) => setPartyId(i?.id ?? null)} />
              </Field>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Direction">
              <Select value={direction} onChange={(e) => setDirection(e.target.value as "owed_to" | "owes_us")}>
                <option value="owed_to">Owed to them (+)</option>
                <option value="owes_us">They owe us (−)</option>
              </Select>
            </Field>
            <Field label="Amount" required>
              <MoneyInput value={magnitude} onChange={setMagnitude} currency={currency} />
            </Field>
            <Field label="Currency">
              <CurrencySelect value={currency} onChange={setCurrency} />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="As of" required hint="A real date — may be in the past.">
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} required />
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </Field>
          </div>
          {formError && <ErrorNote message={formError} />}
          <Button type="submit" disabled={busy || !asOf || !(Number(magnitude) > 0) || (scope === "party" && !partyId)}>
            {busy ? "Saving…" : "Record opening balance"}
          </Button>
        </form>
      </Card>

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (data.length === 0 ? (
        <EmptyState title="No opening balances yet" hint="Record one above to seed a starting position." />
      ) : (
        <Card>
          <ul className="divide-y divide-ink-800">
            {data.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <span className="font-medium">{r.partyId ? <PartyName id={r.partyId} /> : "Business overall"}</span>
                  {r.reversesId && <Badge tone="gray">reversal</Badge>}
                  <span className="ml-2 text-xs text-slate-500">{formatDate(r.asOf)}{r.note ? ` · ${r.note}` : ""}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium tabular-nums">
                    <Money value={Number(r.amount)} prefix={r.currency === "BDT" ? "৳" : `${r.currency} `} signed />
                  </span>
                  {!r.reversesId && (
                    <button type="button" onClick={() => void reverse(r.id)} className="text-xs text-slate-400 hover:underline">
                      reverse
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </AppShell>
  );
}
