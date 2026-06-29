"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { clientLogin } from "@/lib/client-api";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

export default function ClientLoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
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
      await clientLogin(loginId, password, totp || undefined);
      router.replace("/portal");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      if (/totp|2fa|two.?factor/i.test(msg) && !needsTotp) setNeedsTotp(true);
      setError(msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-sky-800">Client portal</h1>
      <p className="mt-1 text-sm text-gray-500">Sign in to see your work and what you owe</p>
      <Card className="mt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Client ID or email">
            <Input autoComplete="username" value={loginId} onChange={(e) => setLoginId(e.target.value)} required />
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
      <p className="mt-4 text-center text-xs text-gray-400">
        Need access? Ask us to set up your portal login.
      </p>
    </main>
  );
}
