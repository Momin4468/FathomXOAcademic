"use client";
import { chargeCategoryLabel, netLabel } from "@/lib/billing";
import { formatDate } from "@/lib/format";
import type { Balance } from "@/lib/types";
import { Badge, Card, EmptyState, Money } from "./ui";

/**
 * Presentational two-way position. Renders ONLY the figures the API returned
 * (computed under the viewer's RLS) — `<Money>` hides any absent value. No money
 * is derived here; the net's sign only drives a label/tone.
 */
export function BalanceView({
  balance,
  perspective = "other",
  onReverseCharge,
}: {
  balance: Balance;
  perspective?: "self" | "other";
  onReverseCharge?: (chargeId: string) => void;
}) {
  const nl = netLabel(balance.net);
  const who = perspective === "self" ? "you" : "this party";
  const netText =
    balance.net === undefined || balance.net === null
      ? "—"
      : Number(balance.net) > 0
        ? `owed to ${who}`
        : Number(balance.net) < 0
          ? perspective === "self"
            ? "you owe the business"
            : "owed to the business"
          : "settled";

  return (
    <div className="space-y-4">
      {/* Net position */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Net position</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              <Money value={balance.net} />
            </p>
          </div>
          <Badge tone={nl.tone}>{netText}</Badge>
        </div>
      </Card>

      {/* Earnings */}
      <Card>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Earnings (business → party)</p>
        <dl className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-xs text-gray-500">owed</dt>
            <dd className="font-medium"><Money value={balance.earnings.owed} /></dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">paid</dt>
            <dd className="font-medium"><Money value={balance.earnings.paid} /></dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">outstanding</dt>
            <dd className="font-medium text-gray-800"><Money value={balance.earnings.outstanding} /></dd>
          </div>
        </dl>
      </Card>

      {/* Charges (dues) */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Charges (party → business dues)</p>
          <span className="text-sm font-medium">
            outstanding <Money value={balance.charges.outstanding} />
          </span>
        </div>
        {balance.charges.items.length === 0 ? (
          <EmptyState title="No charges" />
        ) : (
          <ul className="divide-y divide-gray-100">
            {balance.charges.items.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <span className="inline-flex items-center gap-2">
                    <Badge tone="amber">{chargeCategoryLabel(c.category)}</Badge>
                    {c.reason ? <span className="text-gray-600">{c.reason}</span> : null}
                  </span>
                  <div className="mt-0.5 text-xs text-gray-500">{formatDate(c.createdAt)}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-right">
                    <span className="block font-medium"><Money value={c.amount} /></span>
                    <span className="block text-xs text-gray-500">due <Money value={c.due} /></span>
                  </span>
                  {onReverseCharge && Number(c.amount) > 0 && (
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => onReverseCharge(c.id)}>
                      reverse
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
