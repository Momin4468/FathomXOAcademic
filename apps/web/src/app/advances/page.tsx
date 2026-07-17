"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { sanitizeAmount } from "@/lib/format";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { useConfirm } from "@/components/confirm";
import { Badge, Card, CardHead, DGrid, Field, GhostButton, GoldButton, Loading, Note, Page, StatCards, T, cell, dcInput, fmtDay, money, type DAction, type Stat } from "@/components/dc";

/**
 * Business-plane loan/advance ledger (P1 item 11). Advances to writers, vendors,
 * or any named person; outstanding is derived (never stored). Disjoint from the
 * money ledger — this is a separate receivable/payable book.
 */
interface AdvanceRow {
  id: string;
  counterpartyPartyId: string;
  counterpartyName: string | null;
  direction: "given" | "taken";
  principal: string;
  currency: string;
  startedOn: string;
  dueOn: string | null;
  note: string | null;
  outstanding: string;
}

type PartyRow = { id: string; displayName: string; externalRef?: string | null };
const searchParty = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: p.externalRef ?? undefined }));
};

export default function AdvancesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<AdvanceRow[]>("advances");
  const canCreate = can(me?.permissions, "advances:create");
  const canApprove = can(me?.permissions, "advances:approve");
  const confirm = useConfirm();
  const [eventFor, setEventFor] = useState<AdvanceRow | null>(null);

  async function archive(a: AdvanceRow) {
    if (!(await confirm({ title: "Archive this advance?", danger: true, confirmLabel: "Archive" }))) return;
    await apiSend(`advances/${a.id}/archive`, "POST");
    if (eventFor?.id === a.id) setEventFor(null);
    mutate();
  }

  const rows = data ?? [];
  const owedToUs = rows.filter((a) => a.direction === "given").reduce((s, a) => s + Number(a.outstanding || 0), 0);
  const weOwe = rows.filter((a) => a.direction === "taken").reduce((s, a) => s + Number(a.outstanding || 0), 0);
  const stats: Stat[] = [
    { label: "Owed to us", value: money(owedToUs), tone: "amber", note: "given — outstanding" },
    { label: "We owe", value: money(weOwe), tone: "gray", note: "taken — outstanding" },
  ];

  const actions: DAction<AdvanceRow>[] = [
    ...(canCreate ? [{ label: "event", onClick: (a: AdvanceRow) => setEventFor((cur) => (cur?.id === a.id ? null : a)) }] : []),
    ...(canApprove ? [{ label: "archive", onClick: (a: AdvanceRow) => void archive(a), color: T.red }] : []),
  ];

  return (
    <AppShell>
      <Page title="Advances & loans" sub="business-side advances to writers, vendors, or anyone — outstanding is derived from the events, separate from the work/payment ledger">
        {data && data.length > 0 && <StatCards items={stats} min={200} />}

        {canCreate && <NewAdvance onSaved={mutate} />}

        {eventFor && canCreate && (
          <AdvanceEvent key={eventFor.id} advance={eventFor} onClose={() => setEventFor(null)} onSaved={mutate} />
        )}

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<AdvanceRow>
            rows={data}
            keyOf={(a) => a.id}
            search
            exportName="advances"
            cols={[
              { label: "Counterparty", text: (a) => a.counterpartyName ?? a.counterpartyPartyId, render: (a) => cell(a.counterpartyName ?? a.counterpartyPartyId, { weight: 500, sub: a.note ?? undefined }) },
              { label: "Direction", text: (a) => a.direction, render: (a) => <Badge tone={a.direction === "given" ? "amber" : "gray"}>{a.direction}</Badge> },
              { label: "Principal", align: "right", text: (a) => Number(a.principal), render: (a) => cell(money(a.principal), { nums: true }) },
              { label: "Started", text: (a) => a.startedOn, render: (a) => <span style={{ color: T.muted2 }}>{fmtDay(a.startedOn)}</span> },
              { label: "Due", text: (a) => a.dueOn ?? "", render: (a) => <span style={{ color: T.muted2 }}>{a.dueOn ? fmtDay(a.dueOn) : "—"}</span> },
              { label: "Outstanding", align: "right", text: (a) => Number(a.outstanding), render: (a) => cell(money(a.outstanding), { nums: true, weight: 700, color: T.ink }) },
            ]}
            actions={actions.length ? actions : undefined}
            empty="No advances yet. Record one above."
            foot="Outstanding is derived from each advance's events (disbursement, repayment, adjustment) — never stored."
          />
        )}
      </Page>
    </AppShell>
  );
}

function NewAdvance({ onSaved }: { onSaved: () => void }) {
  const [party, setParty] = useState<PickItem | null>(null);
  const [newName, setNewName] = useState("");
  const [direction, setDirection] = useState<"given" | "taken">("given");
  const [principal, setPrincipal] = useState("");
  const [startedOn, setStartedOn] = useState(new Date().toISOString().slice(0, 10));
  const [dueOn, setDueOn] = useState("");
  const [note, setNote] = useState("");
  const [pickerKey, setPickerKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(principal);
    if (!(amt > 0) || (!party && !newName.trim())) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend("advances", "POST", {
        ...(party ? { counterpartyPartyId: party.id } : { counterpartyName: newName.trim() }),
        direction,
        principal: amt,
        startedOn,
        dueOn: dueOn || undefined,
        note: note.trim() || undefined,
      });
      setParty(null);
      setNewName("");
      setPrincipal("");
      setDueOn("");
      setNote("");
      setPickerKey((n) => n + 1);
      onSaved();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record the advance") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Record an advance / loan</CardHead>
      <form onSubmit={save} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <Field label="Counterparty (search)" error={fieldErrs.counterpartyPartyId}>
          <EntityPicker key={pickerKey} placeholder="Writer, vendor, anyone…" search={searchParty} onPick={setParty} />
        </Field>
        <Field label="…or a new name" error={fieldErrs.counterpartyName}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New person" disabled={!!party} style={{ ...dcInput, opacity: party ? 0.55 : 1 }} />
        </Field>
        <Field label="Direction" error={fieldErrs.direction}>
          <select value={direction} onChange={(e) => setDirection(e.target.value as "given" | "taken")} style={dcInput}>
            <option value="given">Given (they owe us)</option>
            <option value="taken">Taken (we owe them)</option>
          </select>
        </Field>
        <Field label="Principal (৳)" error={fieldErrs.principal}>
          <input inputMode="decimal" value={principal} onChange={(e) => setPrincipal(sanitizeAmount(e.target.value))} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
        </Field>
        <Field label="Started" error={fieldErrs.startedOn}>
          <input type="date" value={startedOn} onChange={(e) => setStartedOn(e.target.value)} style={dcInput} />
        </Field>
        <Field label="Due (optional)" error={fieldErrs.dueOn}>
          <input type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} style={dcInput} />
        </Field>
        <Field label="Note (optional)" error={fieldErrs.note}>
          <input value={note} onChange={(e) => setNote(e.target.value)} style={dcInput} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <GhostButton type="submit" disabled={busy || !(Number(principal) > 0) || (!party && !newName.trim())}>{busy ? "Saving…" : "Record"}</GhostButton>
        </div>
        {err && <div style={{ gridColumn: "1 / -1" }}><Note>{err}</Note></div>}
      </form>
    </Card>
  );
}

function AdvanceEvent({ advance, onClose, onSaved }: { advance: AdvanceRow; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<"repayment" | "disbursement" | "adjustment">("repayment");
  const [amount, setAmount] = useState("");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});

  async function addEvent(e: React.FormEvent) {
    e.preventDefault();
    const amt = Number(amount);
    if (!amt) return;
    setBusy(true);
    setErr("");
    setFieldErrs({});
    try {
      await apiSend(`advances/${advance.id}/events`, "POST", { kind, amount: amt, occurredOn });
      setAmount("");
      onSaved();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record the event") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ marginBottom: 16 }}>
      <CardHead>Record event · {advance.counterpartyName ?? "advance"} · outstanding {money(advance.outstanding)}</CardHead>
      <form onSubmit={addEvent} style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, alignItems: "end" }}>
        <Field label="Kind" error={fieldErrs.kind}>
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={dcInput}>
            <option value="repayment">Repayment</option>
            <option value="disbursement">Disbursement</option>
            <option value="adjustment">Adjustment</option>
          </select>
        </Field>
        <Field label="Amount (৳)" error={fieldErrs.amount}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(sanitizeAmount(e.target.value))} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
        </Field>
        <Field label="Date" error={fieldErrs.occurredOn}>
          <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} style={dcInput} />
        </Field>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
          <GoldButton type="submit" disabled={busy || !Number(amount)}>{busy ? "Saving…" : "Add"}</GoldButton>
          <GhostButton onClick={onClose}>Close</GhostButton>
        </div>
        {err && <div style={{ gridColumn: "1 / -1" }}><Note>{err}</Note></div>}
      </form>
    </Card>
  );
}
