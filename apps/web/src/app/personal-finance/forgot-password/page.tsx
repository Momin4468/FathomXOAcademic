"use client";
import Link from "next/link";
import { useState } from "react";
import { pfRequestReset } from "@/lib/pf-api";
import { Button, Card, Field, Input } from "@/components/ui";

export default function PfForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await pfRequestReset(email);
    } catch {
      /* generic: never reveal failure/existence */
    }
    setSent(true);
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-emerald-800">Reset your password</h1>
      <p className="mt-1 text-sm text-gray-500">We'll email you a link to choose a new one.</p>
      <Card className="mt-6">
        {sent ? (
          <div className="space-y-3 text-sm text-gray-600">
            <p>
              If an account exists for that email, we've sent a password-reset link. It expires
              shortly and can be used once — check your inbox (and spam).
            </p>
            <Link href="/personal-finance/login" className="inline-block font-medium text-emerald-700 hover:underline">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email">
              <Input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
          <Link href="/personal-finance/login" className="font-medium text-emerald-700 hover:underline">
            Back to sign in
          </Link>
        </p>
      )}
    </main>
  );
}
