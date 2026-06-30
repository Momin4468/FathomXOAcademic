"use client";
import Link from "next/link";
import { useState } from "react";
import { clientRequestReset } from "@/lib/client-api";
import { Button, Card, Field, Input } from "@/components/ui";

export default function ClientForgotPasswordPage() {
  const [loginId, setLoginId] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await clientRequestReset(loginId);
    } catch {
      /* generic: never reveal failure/existence */
    }
    setSent(true);
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-sky-800">Reset your password</h1>
      <p className="mt-1 text-sm text-gray-500">We'll email a reset link to the address on file.</p>
      <Card className="mt-6">
        {sent ? (
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              If an account matches that ID, we've sent a password-reset link to the email on file.
              It expires shortly and can be used once — check your inbox (and spam).
            </p>
            <Link href="/portal/login" className="inline-block font-medium text-sky-700 hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Client ID or email">
              <Input
                autoComplete="username"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          </form>
        )}
      </Card>
      {!sent && (
        <p className="mt-4 text-center text-sm text-gray-500">
          <Link href="/portal/login" className="font-medium text-sky-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      )}
    </main>
  );
}
