"use client";
import { useApi } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Card, EmptyState, Money, Spinner, cx } from "./ui";

interface RegRow { date: string; kind: string; ref: string | null; delta: number; running: number }
interface Reg { rows: RegRow[]; net: number }

/**
 * QuickBooks-style running-balance register — a time-ordered ledger with a
 * running Balance column. Opacity-safe (the endpoint scopes to the caller's
 * visible legs). `+` = owed to the party, `−` = they owe / were paid.
 */
export function Register({ path, title = "Register" }: { path: string | null; title?: string }) {
  const { data, isLoading } = useApi<Reg>(path);
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {data && (
          <span className="text-sm text-slate-400">Balance{" "}
            <span className="font-semibold tabular-nums text-slate-100"><Money value={data.net} signed /></span>
          </span>
        )}
      </div>
      {isLoading ? (
        <div className="p-4"><Spinner /></div>
      ) : !data || data.rows.length === 0 ? (
        <div className="p-4"><EmptyState title="No ledger entries yet" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-1.5 font-medium">Date</th>
                <th className="px-4 py-1.5 font-medium">Entry</th>
                <th className="px-4 py-1.5 text-right font-medium">Amount</th>
                <th className="px-4 py-1.5 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-ink-800/60">
                  <td className="px-4 py-1.5 text-xs text-slate-400">{formatDate(r.date)}</td>
                  <td className="px-4 py-1.5">{r.kind}{r.ref ? <span className="ml-1 text-xs text-slate-400">· {r.ref}</span> : null}</td>
                  <td className={cx("px-4 py-1.5 text-right tabular-nums", r.delta < 0 && "text-red-600 dark:text-red-400")}>
                    {r.delta < 0 ? "−" : "+"}<Money value={Math.abs(r.delta)} />
                  </td>
                  <td className="px-4 py-1.5 text-right font-medium tabular-nums"><Money value={r.running} signed /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
