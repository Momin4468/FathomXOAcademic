"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatMoney } from "@/lib/format";
import { can, type Expense, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import {
  Button,
  Card,
  DateInput,
  ErrorNote,
  Field,
  Input,
  Money,
  MoneyInput,
  Select,
  Spinner,
} from "@/components/ui";

const CATEGORIES = ["subscription", "salary", "promo", "loss", "event", "other"];
const COST_BEARERS = ["party", "split", "writer"];
const CURRENCIES = ["BDT", "USD", "GBP", "EUR", "AUD"];

type PartyRow = { id: string; displayName: string; externalRef?: string | null };
// Cost-bearer parties are partners; search the directory (pick-don't-type).
const searchPartner = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}&type=partner`);
  return rows.map((p) => ({ id: p.id, label: p.displayName, sub: p.externalRef ?? undefined }));
};

export default function ExpensesPage() {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const { data, error, isLoading, mutate } = useApi<{ expenses: Expense[]; total: string }>("expenses");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "subscription",
    amount: "",
    incurredAt: new Date().toISOString().slice(0, 10),
    costBearer: "party",
    campaignTag: "",
    note: "",
    nextDueDate: "",
    currency: "BDT",
  });
  // cost_bearer='party' → one bearer; 'split' → a list of {party, share}.
  const [bearer, setBearer] = useState<PickItem | null>(null);
  const [splitRows, setSplitRows] = useState<Array<{ id: string; label: string; share: string }>>([]);
  const [splitKey, setSplitKey] = useState(0); // remount the add-picker after each add
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [reminderMsg, setReminderMsg] = useState("");

  const canCreate = can(me?.permissions, "expenses:create");
  const canApprove = can(me?.permissions, "expenses:approve");

  const dirty = !!form.amount || !!bearer || !!form.note || splitRows.length > 0;
  const { confirmClose } = useUnsavedGuard(dirty);

  async function runReminders() {
    setReminderMsg("");
    try {
      const r = await apiSend<{ sent: number }>("expenses/reminders/run", "POST");
      setReminderMsg(`Reminders sent: ${r.sent}`);
    } catch (err) {
      setReminderMsg(err instanceof Error ? err.message : "Could not run reminders");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.costBearer === "party" && !bearer) {
      setFormError("Pick the partner who bears this cost.");
      return;
    }
    if (form.costBearer === "split" && splitRows.some((r) => !(Number(r.share) > 0))) {
      setFormError("Each split party needs a positive share.");
      return;
    }
    setBusy(true);
    setFormError("");
    setFieldErrs({});
    try {
      await apiSend("expenses", "POST", {
        category: form.category,
        amount: Number(form.amount),
        incurredAt: form.incurredAt,
        costBearer: form.costBearer,
        bearerPartyId: form.costBearer === "party" ? bearer?.id : undefined,
        costBearerSplitJson:
          form.costBearer === "split"
            ? Object.fromEntries(splitRows.map((r) => [r.id, Number(r.share)]))
            : undefined,
        campaignTag: form.category === "promo" && form.campaignTag ? form.campaignTag : undefined,
        note: form.note || undefined,
        nextDueDate: form.category === "subscription" && form.nextDueDate ? form.nextDueDate : undefined,
        currency: form.category === "subscription" ? form.currency : undefined,
      });
      setOpen(false);
      setForm({ ...form, amount: "", campaignTag: "", note: "", nextDueDate: "" });
      setBearer(null);
      setSplitRows([]);
      await mutate();
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setFormError(bannerMessage(err, "Could not save expense") ?? "");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Expenses</h1>
          {data && (
            <p className="text-xs text-gray-500">
              Total: <Money value={data.total} />
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canApprove && <Button variant="secondary" onClick={runReminders}>Run reminders</Button>}
          {canCreate && <Button onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add expense"}</Button>}
        </div>
      </div>
      <div aria-live="polite">
        {reminderMsg && <p className="mb-3 text-xs text-green-700">{reminderMsg}</p>}
      </div>

      {open && canCreate && (
        <Card className="mb-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category" error={fieldErrs.category}>
                <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Amount" error={fieldErrs.amount}>
                <MoneyInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} required />
              </Field>
              <Field label="Cost bearer" error={fieldErrs.costBearer}>
                <Select value={form.costBearer} onChange={(e) => setForm({ ...form, costBearer: e.target.value })}>
                  {COST_BEARERS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Incurred on" error={fieldErrs.incurredAt}>
                <DateInput value={form.incurredAt} onChange={(v) => setForm({ ...form, incurredAt: v })} />
              </Field>
            </div>
            {form.costBearer === "party" && (
              <Field label="Borne by" hint="The partner who bears this cost." error={fieldErrs.bearerPartyId}>
                <EntityPicker placeholder="Search partner…" search={searchPartner} onPick={setBearer} />
              </Field>
            )}
            {form.costBearer === "split" && (
              <Field label="Split between" hint="Add each partner and their share." error={fieldErrs.costBearerSplitJson}>
                <div className="space-y-2">
                  {splitRows.map((r, i) => (
                    <div key={r.id} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm">{r.label}</span>
                      <MoneyInput
                        className="w-24"
                        value={r.share}
                        onChange={(v) =>
                          setSplitRows(splitRows.map((x, j) => (j === i ? { ...x, share: v } : x)))
                        }
                      />
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:underline"
                        onClick={() => setSplitRows(splitRows.filter((_, j) => j !== i))}
                      >
                        remove
                      </button>
                    </div>
                  ))}
                  <EntityPicker
                    key={splitKey}
                    placeholder="Add a partner…"
                    search={searchPartner}
                    onPick={(item) => {
                      if (item && !splitRows.some((r) => r.id === item.id)) {
                        setSplitRows([...splitRows, { id: item.id, label: item.label, share: "" }]);
                      }
                      setSplitKey((k) => k + 1);
                    }}
                  />
                </div>
              </Field>
            )}
            {form.category === "promo" && (
              <Field label="Campaign tag" error={fieldErrs.campaignTag}>
                <Input value={form.campaignTag} onChange={(e) => setForm({ ...form, campaignTag: e.target.value })} placeholder="e.g. JuneAds" />
              </Field>
            )}
            {form.category === "subscription" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Next due date" hint="A reminder fires 3 days before." error={fieldErrs.nextDueDate}>
                  <DateInput value={form.nextDueDate} onChange={(v) => setForm({ ...form, nextDueDate: v })} />
                </Field>
                <Field label="Currency" error={fieldErrs.currency}>
                  <Select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                    {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                  </Select>
                </Field>
              </div>
            )}
            <Field label="Note" error={fieldErrs.note}>
              <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </Field>
            {formError && <ErrorNote message={formError} />}
            <Button type="submit" disabled={busy || !form.amount}>
              {busy ? "Saving…" : "Save expense"}
            </Button>
          </form>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {data && (
        <DataTable<Expense>
          tableId="expenses"
          exportName="expenses"
          rows={data.expenses}
          getRowId={(x) => x.id}
          emptyTitle="No expenses yet"
          columns={[
            {
              key: "category",
              header: "Category",
              sortable: true,
              filter: "select",
              filterOptions: CATEGORIES,
              render: (x) => (
                <span>
                  <span className="capitalize">{x.category}</span>
                  {x.campaignTag ? <span className="ml-2 text-xs text-gray-400">#{x.campaignTag}</span> : null}
                </span>
              ),
              value: (x) => x.category,
            },
            {
              key: "amount",
              header: "Amount",
              align: "right",
              sortable: true,
              // Expenses can be non-BDT; no total to avoid mixing currencies.
              render: (x) =>
                x.currency && x.currency !== "BDT" ? `${x.currency} ${formatMoney(x.amount, "") ?? x.amount}` : <Money value={x.amount} />,
              value: (x) => (x.amount == null ? "" : Number(x.amount)),
            },
            { key: "costBearer", header: "Bearer", sortable: true, filter: "select", filterOptions: COST_BEARERS, value: (x) => x.costBearer },
            { key: "incurredAt", header: "Date", sortable: true, format: "date", value: (x) => x.incurredAt },
            { key: "note", header: "Note", filter: "text", value: (x) => x.note ?? "" },
          ]}
        />
      )}
    </AppShell>
  );
}
