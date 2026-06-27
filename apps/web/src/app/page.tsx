"use client";
import Link from "next/link";
import { useApi } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { WorkList } from "@/components/WorkList";
import { Button, Spinner } from "@/components/ui";

export default function HomePage() {
  const { data: me, isLoading } = useApi<WhoAmI>("platform/whoami");

  return (
    <AppShell>
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">My open loops</h1>
          <p className="text-xs text-gray-500">What&rsquo;s open and whose move is it?</p>
        </div>
        <div className="flex items-center gap-2">
          {can(me?.permissions, "capture:view") && (
            <Link href="/tasks">
              <Button variant="secondary">Tasks</Button>
            </Link>
          )}
          {can(me?.permissions, "work:create") && (
            <Link href="/work/new">
              <Button>+ Log new</Button>
            </Link>
          )}
        </div>
      </div>

      {isLoading && <Spinner />}

      {me && (
        <div className="space-y-6">
          {/* Admin / approver: the confirmation queue + active work. */}
          {can(me.permissions, "work:approve") && (
            <>
              <WorkList title="Confirmation queue" path="work?workState=pending" emptyHint="No jobs awaiting confirmation." />
              <WorkList title="In progress" path="work?workState=confirmed" emptyHint="No active jobs." />
            </>
          )}

          {/* The viewer's own work (if they're a party / doer). */}
          {me.party && (
            <WorkList title="My work" path={`work?doerPartyId=${me.party.id}`} emptyHint="You have no assigned work yet." />
          )}

          {/* Fallback for a work:view role that's neither approver nor a doer. */}
          {!can(me.permissions, "work:approve") && !me.party && can(me.permissions, "work:view") && (
            <WorkList title="Work" path="work" emptyHint="No work items." />
          )}
        </div>
      )}
    </AppShell>
  );
}
