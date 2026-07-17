"use client";
import { useState } from "react";
import { apiGet, apiSend, useApi } from "@/lib/api";
import { chargeCategoryLabel } from "@/lib/billing";
import { sanitizeAmount } from "@/lib/format";
import { can, type Balance, type PartyRow, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { BalanceView } from "@/components/BalanceView";
import { Register } from "@/components/Register";
import { EntityPicker, type PickItem } from "@/components/EntityPicker";
import { useConfirm } from "@/components/confirm";
import { Card, CardHead, EmptyBox, Field, GoldButton, Loading, Note, Page, T, dcInput } from "@/components/dc";

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
      <Page title="Balance" sub="your two-way position — and, for admins, any party&rsquo;s ledger and dues">
        {/* The viewer's own two-way position (universal). */}
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: T.ink, margin: "0 0 8px" }}>My position</h2>
          {!myPartyId ? (
            <EmptyBox title="No personal balance" hint="Your account isn't linked to a party." />
          ) : myLoading ? (
            <Loading />
          ) : myBalance ? (
            <div style={{ display: "grid", gap: 12 }}>
              <BalanceView balance={myBalance} perspective="self" />
              {myPartyId && <Register path="billing/register/me" title="My register" />}
            </div>
          ) : null}
        </section>

        {/* Admin: look up any party's balance + manage its charges. */}
        {isAdmin && (
          <section style={{ display: "grid", gap: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: T.ink, margin: 0 }}>Look up a party</h2>
            <Card style={{ padding: 16 }}>
              <Field label="Party">
                <EntityPicker placeholder="Search party…" search={searchParties} onPick={(i) => setLookupId(i?.id ?? null)} />
              </Field>
            </Card>

            {lookupId && lookupLoading && <Loading />}
            {lookupId && lookup && (
              <>
                <BalanceView balance={lookup} perspective="other" onReverseCharge={canApprove ? reverseCharge : undefined} />
                <Register path={`billing/register/${encodeURIComponent(lookupId)}`} title="Register" />
                {actionError && <Note>{actionError}</Note>}
                {canCreate && (
                  <Card>
                    <CardHead>Add a charge (party owes the business)</CardHead>
                    <form onSubmit={addCharge} style={{ padding: 16, display: "grid", gap: 12 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                        <Field label="Category">
                          <select value={charge.category} onChange={(e) => setCharge({ ...charge, category: e.target.value })} style={dcInput}>
                            {CHARGE_CATEGORIES.map((c) => (
                              <option key={c} value={c}>{chargeCategoryLabel(c)}</option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Amount" required>
                          <input inputMode="decimal" value={charge.amount} onChange={(e) => setCharge({ ...charge, amount: sanitizeAmount(e.target.value) })} placeholder="৳ amount" style={{ ...dcInput, textAlign: "right" }} />
                        </Field>
                      </div>
                      <Field label="Reason">
                        <input value={charge.reason} onChange={(e) => setCharge({ ...charge, reason: e.target.value })} placeholder="e.g. platform fee June" style={dcInput} />
                      </Field>
                      <div>
                        <GoldButton type="submit" disabled={busy || !charge.amount}>{busy ? "Saving…" : "Add charge"}</GoldButton>
                      </div>
                    </form>
                  </Card>
                )}
              </>
            )}
          </section>
        )}
      </Page>
    </AppShell>
  );
}
