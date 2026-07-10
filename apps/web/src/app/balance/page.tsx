"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { chargeCategoryLabel } from "@/lib/billing";
import { can, type Balance, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { BalanceView } from "@/components/BalanceView";
import { Register } from "@/components/Register";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { useConfirm } from "@/components/confirm";
import { Button, Card, EmptyState, ErrorNote, Field, Input, MoneyInput, Select, Spinner } from "@/components/ui";

const CHARGE_CATEGORIES = ["platform_fee", "ai_check", "adjustment", "other"];

const searchParties = async (q: string): Promise<PickItem[]> => {
  const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
  return rows.map((r) => ({ id: r.id, label: r.displayName, sub: r.partyType?.join(", ") }));
};

export default function BalancePage() {
  const confirm = useConfirm();
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const myPartyId = me?.principal.partyId ?? null;
  const isAdmin = can(me?.permissions, "billing:view");
  const canCreate = can(me?.permissions, "billing:create");
  const canApprove = can(me?.permissions, "billing:approve");

  const { data: myBalance, isLoading: myLoading } = useApi<Balance>(myPartyId ? "billing/balance/me" : null);

  // Admin lookup of any party's balance.
  const [lookupId, setLookupId] = useState<string | null>(null);
  const { data: lookup, isLoading: lookupLoading, mutate: mutateLookup } = useApi<Balance>(
    isAdmin && lookupId ? `billing/balance/${encodeURIComponent(lookupId)}` : null,
  );

  const [charge, setCharge] = useState({ category: "platform_fee", amount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function addCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!lookupId) return;
    const amount = Number(charge.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setActionError("Enter a valid amount");
      return;
    }
    setBusy(true);
    setActionError("");
    try {
      await apiSend("charges", "POST", {
        partyId: lookupId,
        category: charge.category,
        amount,
        reason: charge.reason || undefined,
      });
      setCharge({ category: "platform_fee", amount: "", reason: "" });
      await mutateLookup();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not add charge");
    } finally {
      setBusy(false);
    }
  }

  async function reverseCharge(originalId: string) {
    const reason = await confirm({
      title: "Reverse this charge?",
      danger: true,
      confirmLabel: "Reverse",
      reasonField: { label: "Reason (optional)", placeholder: "why…" },
    });
    if (reason === false) return;
    setBusy(true);
    setActionError("");
    try {
      await apiSend("charges/reverse", "POST", { originalId, reason });
      await mutateLookup();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not reverse charge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Balance</h1>

      {/* The viewer's own two-way position (universal). */}
      <section className="mb-8 space-y-2">
        <h2 className="text-sm font-semibold text-gray-700">My position</h2>
        {!myPartyId ? (
          <EmptyState title="No personal balance" hint="Your account isn't linked to a party." />
        ) : myLoading ? (
          <Spinner />
        ) : myBalance ? (
          <>
            <BalanceView balance={myBalance} perspective="self" />
            {myPartyId && <Register path="billing/register/me" title="My register" />}
          </>
        ) : null}
      </section>

      {/* Admin: look up any party's balance + manage its charges. */}
      {isAdmin && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">Look up a party</h2>
          <Card>
            <Field label="Party">
              <EntityPicker placeholder="Search party…" search={searchParties} onPick={(i) => setLookupId(i?.id ?? null)} />
            </Field>
          </Card>

          {lookupId && lookupLoading && <Spinner />}
          {lookupId && lookup && (
            <>
              <BalanceView balance={lookup} perspective="other" onReverseCharge={canApprove ? reverseCharge : undefined} />
              <Register path={`billing/register/${encodeURIComponent(lookupId)}`} title="Register" />
              {actionError && <ErrorNote message={actionError} />}
              {canCreate && (
                <Card>
                  <p className="mb-2 text-sm font-semibold text-gray-700">Add a charge (party owes the business)</p>
                  <form onSubmit={addCharge} className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label="Category">
                        <Select value={charge.category} onChange={(e) => setCharge({ ...charge, category: e.target.value })}>
                          {CHARGE_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {chargeCategoryLabel(c)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Amount">
                        <MoneyInput value={charge.amount} onChange={(v) => setCharge({ ...charge, amount: v })} required />
                      </Field>
                    </div>
                    <Field label="Reason">
                      <Input value={charge.reason} onChange={(e) => setCharge({ ...charge, reason: e.target.value })} placeholder="e.g. platform fee June" />
                    </Field>
                    <Button type="submit" disabled={busy || !charge.amount}>
                      {busy ? "Saving…" : "Add charge"}
                    </Button>
                  </form>
                </Card>
              )}
            </>
          )}
        </section>
      )}
    </AppShell>
  );
}
