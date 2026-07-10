"use client";
import { useState } from "react";
import Link from "next/link";
import { apiSend, logout, useApi } from "@/lib/api";
import { bannerMessage } from "@/lib/field-errors";
import { type WhoAmI } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge, Button, Card, ErrorNote, Field, Input, Spinner } from "@/components/ui";

/**
 * Self-service profile & security (business plane). A user manages only what is
 * theirs to manage: their own password. Identity facts (email, linked person) are
 * read-only here and roles are shown but NOT editable — role changes are an admin
 * action (no self-promotion, spec §10). Changing the password revokes every
 * session, so on success we sign the user out to re-authenticate cleanly.
 */
export default function ProfilePage() {
  const { data: me, isLoading } = useApi<WhoAmI>("platform/whoami");

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const tooShort = next.length > 0 && next.length < 8;
  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= 8 && next === confirm && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr("");
    try {
      await apiSend("auth/change-password", "POST", { currentPassword: current, newPassword: next });
      setDone(true);
      // Every device was signed out; bounce to login after a beat so the user
      // reads the confirmation.
      setTimeout(() => void logout(), 1600);
    } catch (e2) {
      setErr(bannerMessage(e2, "Could not change password") ?? "Could not change password");
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Profile &amp; security</h1>
      <p className="mb-4 text-xs text-slate-400">Manage your own login. Roles are assigned by an administrator.</p>
      {isLoading && <Spinner />}

      {me && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* Identity (read-only) */}
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Account</h2>
            <dl className="space-y-2.5 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Sign-in email</dt>
                <dd className="font-medium">{me.account?.email ?? <span className="text-slate-500">—</span>}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Linked person</dt>
                <dd className="font-medium">
                  {me.party ? (
                    <Link href={`/people/${me.party.id}`} className="text-gold-600 hover:underline dark:text-gold-400">{me.party.displayName}</Link>
                  ) : (
                    <span className="text-slate-500">Not linked to a person record</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Roles</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {me.roleNames.length ? me.roleNames.map((r) => <Badge key={r} tone="blue">{r}</Badge>) : <span className="text-slate-500">No roles</span>}
                </dd>
              </div>
            </dl>
            <p className="mt-4 border-t border-ink-700 pt-3 text-[11px] text-slate-500">
              Your profile details (name, contact) live on your <Link href={me.party ? `/people/${me.party.id}` : "/people"} className="text-gold-600 hover:underline dark:text-gold-400">person record</Link>. Only an administrator can change your roles.
            </p>
          </Card>

          {/* Change password */}
          <Card className="h-fit">
            <h2 className="mb-3 text-sm font-semibold">Change password</h2>
            {done ? (
              <p className="rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                Password changed. You&apos;ve been signed out of all devices — redirecting you to sign in…
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <Field label="Current password">
                  <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
                </Field>
                <Field label="New password" hint="At least 8 characters" error={tooShort ? "Too short — at least 8 characters." : undefined}>
                  <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
                </Field>
                <Field label="Confirm new password" error={mismatch ? "Passwords do not match." : undefined}>
                  <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </Field>
                {err && <ErrorNote message={err} />}
                <Button type="submit" className="w-full" disabled={!canSubmit}>{busy ? "Changing…" : "Change password"}</Button>
                <p className="text-[11px] text-slate-500">Changing your password signs you out everywhere.</p>
              </form>
            )}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
