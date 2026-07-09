"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { clientResetPassword } from "@/lib/client-api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setFieldErrs({});
    if (pw.length < 8) return setError("Password must be at least 8 characters.");
    if (pw !== pw2) return setError("Passwords don't match.");
    if (!token) return setError("This reset link is invalid or has expired. Please request a new one.");
    setBusy(true);
    try {
      await clientResetPassword(token, pw);
      setDone(true);
    } catch (err) {
      setFieldErrs(fieldErrorMap(err));
      setError(bannerMessage(err, "Could not reset your password.") ?? "");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3 text-sm text-gray-600">
        <p>Your password has been updated, and any other sessions were signed out.</p>
        <Link href="/portal/login" className="inline-block font-medium text-sky-700 hover:underline">
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" hint="At least 8 characters" error={fieldErrs.newPassword}>
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

export default function ClientResetPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-sky-800">Choose a new password</h1>
      <p className="mt-1 text-sm text-gray-500">Enter a new password for your portal login.</p>
      <Card className="mt-6">
        <Suspense fallback={<p className="text-sm text-gray-500">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </Card>
    </main>
  );
}
