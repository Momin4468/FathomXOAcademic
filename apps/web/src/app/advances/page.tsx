"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { formatDate } from "@/lib/format";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { useConfirm } from "@/components/confirm";
import { Badge, Button, Card, DateInput, EmptyState, ErrorNote, Field, Input, MoneyInput, Money, Select, Spinner } from "@/components/ui";

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

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Advances &amp; loans</h1>
      <p className="mb-5 text-xs text-gray-500">
        Business-side advances to writers, vendors, or anyone. Outstanding is derived from the events below — separate from the work/payment ledger.
      </p>

      {canCreate && <NewAdvance onSaved={mutate} />}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && data.length === 0 && <EmptyState title="No advances yet" hint="Record one above." />}
      {data && data.length > 0 && (
        <div className="space-y-2">
          {data.map((a) => (
            <AdvanceCard key={a.id} advance={a} canCreate={canCreate} canApprove={canApprove} onChange={mutate} />
          ))}
        </div>
      )}
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
    <Card className="mb-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Record an advance / loan</h2>
      <form onSubmit={save} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Counterparty (search)" error={fieldErrs.counterpartyPartyId}>
          <EntityPicker key={pickerKey} placeholder="Writer, vendor, anyone…" search={searchParty} onPick={setParty} />
        </Field>
        <Field label="…or a new name" error={fieldErrs.counterpartyName}>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New person" disabled={!!party} />
        </Field>
        <Field label="Direction" error={fieldErrs.direction}>
          <Select value={direction} onChange={(e) => setDirection(e.target.value as "given" | "taken")}>
            <option value="given">Given (they owe us)</option>
            <option value="taken">Taken (we owe them)</option>
          </Select>
        </Field>
        <Field label="Principal (৳)" error={fieldErrs.principal}>
          <MoneyInput value={principal} onChange={(v) => setPrincipal(v)} />
        </Field>
        <Field label="Started" error={fieldErrs.startedOn}>
          <DateInput value={startedOn} onChange={setStartedOn} />
        </Field>
        <Field label="Due (optional)" error={fieldErrs.dueOn}>
          <DateInput value={dueOn} onChange={setDueOn} />
        </Field>
        <Field label="Note (optional)" error={fieldErrs.note}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" disabled={busy || !(Number(principal) > 0) || (!party && !newName.trim())}>
            {busy ? "Saving…" : "Record"}
          </Button>
        </div>
        {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
      </form>
    </Card>
  );
}

function AdvanceCard({
  advance,
  canCreate,
  canApprove,
  onChange,
}: {
  advance: AdvanceRow;
  canCreate: boolean;
  canApprove: boolean;
  onChange: () => void;
}) {
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
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
      onChange();
    } catch (e2) {
      setFieldErrs(fieldErrorMap(e2));
      setErr(bannerMessage(e2, "Could not record the event") ?? "");
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!(await confirm({ title: "Archive this advance?", danger: true, confirmLabel: "Archive" }))) return;
    await apiSend(`advances/${advance.id}/archive`, "POST");
    onChange();
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{advance.counterpartyName ?? advance.counterpartyPartyId}</span>
          <Badge tone={advance.direction === "given" ? "amber" : "gray"}>{advance.direction}</Badge>
          {advance.note && <span className="text-xs text-gray-400">{advance.note}</span>}
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">outstanding</div>
          <div className="text-sm font-semibold tabular-nums"><Money value={advance.outstanding} /></div>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
        <span>principal <Money value={advance.principal} /></span>
        <span>started {formatDate(advance.startedOn)}</span>
        {advance.dueOn && <span>due {formatDate(advance.dueOn)}</span>}
        {canCreate && (
          <button type="button" className="ml-auto text-gray-500 hover:text-gray-900" onClick={() => setOpen((o) => !o)}>
            {open ? "Close" : "Record event"}
          </button>
        )}
        {canApprove && (
          <button type="button" className="text-gray-400 hover:text-red-600" onClick={archive}>
            Archive
          </button>
        )}
      </div>
      {open && canCreate && (
        <form onSubmit={addEvent} className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
          <Field label="Kind" error={fieldErrs.kind}>
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="repayment">Repayment</option>
              <option value="disbursement">Disbursement</option>
              <option value="adjustment">Adjustment</option>
            </Select>
          </Field>
          <Field label="Amount (৳)" error={fieldErrs.amount}>
            <MoneyInput value={amount} onChange={(v) => setAmount(v)} className="w-28" />
          </Field>
          <Field label="Date" error={fieldErrs.occurredOn}>
            <DateInput value={occurredOn} onChange={setOccurredOn} />
          </Field>
          <Button type="submit" variant="secondary" className="text-xs" disabled={busy || !Number(amount)}>
            {busy ? "Saving…" : "Add"}
          </Button>
          {err && <div className="w-full"><ErrorNote message={err} /></div>}
        </form>
      )}
    </Card>
  );
}
