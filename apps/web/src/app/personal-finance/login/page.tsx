"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pfLogin } from "@/lib/pf-api";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

export default function PfLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await pfLogin(email, password, totp || undefined);
      router.replace("/personal-finance");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (/totp|2fa|two.?factor/i.test(msg) && !needsTotp) setNeedsTotp(true);
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-emerald-800">Personal Finance</h1>
      <p className="mt-1 text-sm text-gray-500">Your private money — only you can see it.</p>
      <Card className="mt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email">
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {needsTotp && (
            <Field label="2FA code" hint="From your authenticator app">
              <Input inputMode="numeric" value={totp} onChange={(e) => setTotp(e.target.value)} />
            </Field>
          )}
          {error && <ErrorNote message={error} />}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-gray-500">
        New here?{" "}
        <Link href="/personal-finance/register" className="font-medium text-emerald-700 hover:underline">
          Create an account
        </Link>
      </p>
    </main>
  );
}
