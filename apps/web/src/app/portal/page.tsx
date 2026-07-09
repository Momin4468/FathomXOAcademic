"use client";
import Link from "next/link";
import { useClientApi } from "@/lib/client-api";
import { formatDate } from "@/lib/format";
import { ClientPortalShell } from "@/components/ClientPortalShell";
import { Badge, Button, Card, EmptyState, ErrorNote, Money, Spinner } from "@/components/ui";

// Client-facing labels — never leak internal lifecycle words to a client.
const WORK_LABEL: Record<string, string> = {
  draft: "Received",
  pending: "In review",
  confirmed: "Confirmed",
  delivered: "Completed",
};
const MONEY_LABEL: Record<string, string> = {
  unbilled: "Awaiting quote",
  invoiced: "Invoiced",
  partial: "Part-paid",
  settled: "Paid",
};
const WORK_TONE: Record<string, string> = {
  draft: "gray",
  pending: "amber",
  confirmed: "blue",
  delivered: "green",
};

interface ClientWork {
  workItemId: string;
  title: string;
  workState: string;
  moneyState: string;
  amountBilled: string;
  amountPaid: string;
  amountDue: string;
  createdAt: string;
}
interface Summary {
  billed: number;
  paid: number;
  due: number;
}

export default function PortalHome() {
  const { data: works, error, isLoading } = useClientApi<ClientWork[]>("works");
  const { data: summary } = useClientApi<Summary>("summary");

  return (
    <ClientPortalShell>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">My requests</h1>
        <Link href="/portal/requests/new">
          <Button>Submit a request</Button>
        </Link>
      </div>

      {summary && (
        <Card className="mb-5">
          <div className="grid grid-cols-1 gap-2 text-center sm:grid-cols-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Billed</p>
              <p className="mt-1 font-semibold"><Money value={summary.billed} /></p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Paid</p>
              <p className="mt-1 font-semibold"><Money value={summary.paid} /></p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">Amount due</p>
              <p className="mt-1 font-semibold text-sky-800"><Money value={summary.due} /></p>
            </div>
          </div>
        </Card>
      )}

      {isLoading && <Spinner />}
      {error && <ErrorNote message={error.message} />}
      {works && works.length === 0 && (
        <EmptyState title="No requests yet" hint="Submit a request and we’ll get back to you with a quote." />
      )}
      {works && works.length > 0 && (
        <div className="space-y-2">
          {works.map((w) => (
            <Card key={w.workItemId}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{w.title}</p>
                  <p className="mt-1 flex items-center gap-2 text-xs text-gray-400">
                    <Badge tone={WORK_TONE[w.workState] ?? "gray"}>{WORK_LABEL[w.workState] ?? w.workState}</Badge>
                    <Badge tone="gray">{MONEY_LABEL[w.moneyState] ?? w.moneyState}</Badge>
                    <span>· {formatDate(w.createdAt)}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">due</p>
                  <p className="font-medium"><Money value={w.amountDue} /></p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </ClientPortalShell>
  );
}
