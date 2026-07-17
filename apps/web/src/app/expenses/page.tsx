"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { formatMoney, sanitizeAmount } from "@/lib/format";
import { can, type Expense, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { Card, DGrid, Field, GhostButton, GoldButton, Loading, Note, Page, StatCards, T, cell, dcInput, fmtDay, money, type Stat } from "@/components/dc";

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

  const stats: Stat[] = data
    ? [{ label: "Total (BDT)", value: money(data.total), tone: "gold", note: `${data.expenses.length} expense${data.expenses.length === 1 ? "" : "s"}` }]
    : [];

  return (
    <AppShell>
      <Page
        title="Expenses"
        sub="operating costs — who bears each one (a partner, a split, or the writer)"
        action={
          canApprove || canCreate ? (
            <div style={{ display: "flex", gap: 8 }}>
              {canApprove && <GhostButton onClick={runReminders}>Run reminders</GhostButton>}
              {canCreate && <GoldButton onClick={() => (open ? confirmClose(() => setOpen(false)) : setOpen(true))}>{open ? "Close" : "+ Add expense"}</GoldButton>}
            </div>
          ) : undefined
        }
      >
        {data && <StatCards items={stats} min={200} />}
        <div aria-live="polite">
          {reminderMsg && <div style={{ marginBottom: 12, fontSize: 12, fontWeight: 600, color: T.green }}>{reminderMsg}</div>}
        </div>

        {open && canCreate && (
          <Card style={{ padding: 16, marginBottom: 16 }}>
            <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                <Field label="Category" error={fieldErrs.category}>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} style={dcInput}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Amount" error={fieldErrs.amount}>
                  <input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: sanitizeAmount(e.target.value) })} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
                </Field>
                <Field label="Cost bearer" error={fieldErrs.costBearer}>
                  <select value={form.costBearer} onChange={(e) => setForm({ ...form, costBearer: e.target.value })} style={dcInput}>
                    {COST_BEARERS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Incurred on" error={fieldErrs.incurredAt}>
                  <input type="date" value={form.incurredAt} onChange={(e) => setForm({ ...form, incurredAt: e.target.value })} style={dcInput} />
                </Field>
              </div>
              {form.costBearer === "party" && (
                <Field label="Borne by" hint="The partner who bears this cost." error={fieldErrs.bearerPartyId}>
                  <EntityPicker placeholder="Search partner…" search={searchPartner} onPick={setBearer} />
                </Field>
              )}
              {form.costBearer === "split" && (
                <Field label="Split between" hint="Add each partner and their share." error={fieldErrs.costBearerSplitJson}>
                  <div style={{ display: "grid", gap: 8 }}>
                    {splitRows.map((r, i) => (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{r.label}</span>
                        <input
                          inputMode="decimal"
                          value={r.share}
                          onChange={(e) => setSplitRows(splitRows.map((x, j) => (j === i ? { ...x, share: sanitizeAmount(e.target.value) } : x)))}
                          placeholder="৳ share"
                          style={{ ...dcInput, width: 110, textAlign: "right" }}
                        />
                        <button
                          type="button"
                          onClick={() => setSplitRows(splitRows.filter((_, j) => j !== i))}
                          style={{ fontSize: 11, color: T.muted, background: "none", border: "none", cursor: "pointer" }}
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
                  <input value={form.campaignTag} onChange={(e) => setForm({ ...form, campaignTag: e.target.value })} placeholder="e.g. JuneAds" style={dcInput} />
                </Field>
              )}
              {form.category === "subscription" && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  <Field label="Next due date" hint="A reminder fires 3 days before." error={fieldErrs.nextDueDate}>
                    <input type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })} style={dcInput} />
                  </Field>
                  <Field label="Currency" error={fieldErrs.currency}>
                    <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={dcInput}>
                      {CURRENCIES.map((c) => (<option key={c} value={c}>{c}</option>))}
                    </select>
                  </Field>
                </div>
              )}
              <Field label="Note" error={fieldErrs.note}>
                <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} style={dcInput} />
              </Field>
              {formError && <Note>{formError}</Note>}
              <div>
                <GoldButton type="submit" disabled={busy || !form.amount}>{busy ? "Saving…" : "Save expense"}</GoldButton>
              </div>
            </form>
          </Card>
        )}

        {isLoading && <Loading />}
        {error && <Note>{error.message}</Note>}
        {data && (
          <DGrid<Expense>
            rows={data.expenses}
            keyOf={(x) => x.id}
            cols={[
              {
                label: "Category",
                render: (x) => (
                  <span>
                    <span style={{ textTransform: "capitalize" }}>{x.category}</span>
                    {x.campaignTag ? <span style={{ marginLeft: 8, fontSize: 11, color: T.muted2 }}>#{x.campaignTag}</span> : null}
                  </span>
                ),
              },
              {
                label: "Amount",
                align: "right",
                // Expenses can be non-BDT; show the code + amount so currencies aren't mixed.
                render: (x) => cell(x.currency && x.currency !== "BDT" ? `${x.currency} ${formatMoney(x.amount, "") ?? x.amount}` : money(x.amount), { nums: true, weight: 600 }),
              },
              { label: "Bearer", render: (x) => <span style={{ textTransform: "capitalize" }}>{x.costBearer}</span> },
              { label: "Date", render: (x) => <span style={{ color: T.muted2 }}>{fmtDay(x.incurredAt)}</span> },
              { label: "Note", render: (x) => x.note ?? <span style={{ color: T.muted2 }}>—</span> },
            ]}
            empty="No expenses yet."
          />
        )}
      </Page>
    </AppShell>
  );
}
