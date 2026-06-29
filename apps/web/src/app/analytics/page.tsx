"use client";
import { ApiError, useApi } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Card, EmptyState, ErrorNote, Spinner } from "@/components/ui";

interface AnalyticsEmbed {
  url: string;
  scope: "owner" | "member";
  canAdhoc: boolean;
  adhocUrl?: string;
}

export default function AnalyticsPage() {
  const { data: me, isLoading: meLoading } = useApi<WhoAmI>("platform/whoami");
  const allowed = can(me?.permissions, "dashboard:view");
  // Only fetch the embed once we know the viewer is allowed.
  const { data, error, isLoading } = useApi<AnalyticsEmbed>(allowed ? "analytics/embed" : null, {
    shouldRetryOnError: false,
  });
  // A 404 means analytics isn't configured yet (no Metabase secret/dashboard ids).
  const notConfigured = error instanceof ApiError && error.status === 404;

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
          <p className="text-xs text-gray-500">
            {data ? `${data.scope === "owner" ? "Business analytics" : "Your numbers"} · ` : ""}
            powered by Metabase
          </p>
        </div>
        {data?.canAdhoc && data.adhocUrl && (
          <a
            href={data.adhocUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the ad-hoc explorer in Metabase (opens in a new tab)"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-800 transition hover:bg-gray-50"
          >
            Open ad-hoc explorer ↗
          </a>
        )}
      </div>

      {meLoading && <Spinner />}
      {!meLoading && !allowed && <EmptyState title="You don't have access to analytics" />}
      {allowed && isLoading && <Spinner />}
      {allowed && notConfigured && (
        <EmptyState
          title="Analytics isn't set up yet"
          hint="Bring up Metabase and set METABASE_EMBED_SECRET + dashboard IDs (see docs/METABASE_SETUP.md)."
        />
      )}
      {allowed && error && !notConfigured && <ErrorNote message={error.message} />}
      {allowed && data && (
        <Card className="overflow-hidden p-0">
          <iframe title="Analytics dashboard" src={data.url} className="h-[80vh] w-full border-0" />
        </Card>
      )}
    </AppShell>
  );
}
