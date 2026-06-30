"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { pfResetPassword } from "@/lib/pf-api";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== pw2) return setError("Passwords don't match.");
    if (!token) return setError("This reset link is invalid or has expired. Please request a new one.");
    setBusy(true);
    try {
      await pfResetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3 text-sm text-gray-600">
        <p>Your password has been updated, and any other sessions were signed out.</p>
        <Link href="/personal-finance/login" className="inline-block font-medium text-emerald-700 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" hint="At least 8 characters">
        <Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </Field>
      <Field label="Confirm new password">
        <Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
      </Field>
      {error && <ErrorNote message={error} />}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Updating…" : "Set new password"}
      </Button>
    </form>
  );
}

export default function PfResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-emerald-800">Choose a new password</h1>
      <p className="mt-1 text-sm text-gray-500">Enter a new password for your account.</p>
      <Card className="mt-6">
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </Card>
    </main>
  );
}
