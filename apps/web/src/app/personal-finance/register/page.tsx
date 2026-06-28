"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { pfRegister } from "@/lib/pf-api";
import { PF_CURRENCIES } from "@/lib/pf-types";
import { Button, Card, ErrorNote, Field, Input, Select } from "@/components/ui";

export default function PfRegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", displayName: "", baseCurrency: "BDT" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await pfRegister(form.email, form.password, form.displayName || undefined, form.baseCurrency);
      router.replace("/personal-finance");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-xl font-semibold tracking-tight text-emerald-800">Create your account</h1>
      <p className="mt-1 text-sm text-gray-500">A private plane, separate from any business login.</p>
      <Card className="mt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <Input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Your name" />
          </Field>
          <Field label="Email">
            <Input type="email" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </Field>
          <Field label="Password" hint="At least 8 characters">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </Field>
          <Field label="Base currency">
            <Select value={form.baseCurrency} onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}>
              {PF_CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          {error && <ErrorNote message={error} />}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating…" : "Create account"}
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/personal-finance/login" className="font-medium text-emerald-700 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
