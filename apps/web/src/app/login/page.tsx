"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { login } from "@/lib/api";
import { fieldErrorMap, bannerMessage } from "@/lib/field-errors";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setFieldErrs({});
    try {
      await login(email, password, totp || undefined);
      router.replace("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Login failed";
      // Account has 2FA → reveal the code field.
      if (/totp|2fa|two.?factor/i.test(msg) && !needsTotp) setNeedsTotp(true);
      setFieldErrs(fieldErrorMap(err));
      setError(bannerMessage(err, "Login failed") ?? "");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <Logo />
      <p className="mt-3 text-sm text-slate-400">Sign in to your workspace</p>
      <Card className="mt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Email" error={fieldErrs.email}>
            <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" error={fieldErrs.password}>
            <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {needsTotp && (
            <Field label="2FA code" hint="From your authenticator app" error={fieldErrs.totp}>
              <Input inputMode="numeric" autoComplete="one-time-code" value={totp} onChange={(e) => setTotp(e.target.value)} />
            </Field>
          )}
          {error && <ErrorNote message={error} />}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-slate-400">
        <Link href="/forgot-password" className="font-medium text-gold-600 hover:underline dark:text-gold-400">
          Forgot password?
        </Link>
      </p>
    </main>
  );
}
