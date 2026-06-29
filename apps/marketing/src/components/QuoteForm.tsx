"use client";
import { useState } from "react";
import { services } from "@/content/site";
import { whatsappLink } from "@/lib/config";

const ACCEPT = ".pdf,.txt,.doc,.docx,image/*";
const ALLOWED_EXT = [".pdf", ".txt", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".gif"];
const MAX_BYTES = 10 * 1024 * 1024;

const fieldCls =
  "w-full rounded-lg border border-white/10 bg-ink-800/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/60";
const labelCls = "mb-1.5 block text-sm font-medium text-slate-200";

export function QuoteForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [fileName, setFileName] = useState("");

  function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError("");
    const f = e.target.files?.[0];
    if (!f) {
      setFileName("");
      return;
    }
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (f.type.startsWith("video/") || !ALLOWED_EXT.includes(ext)) {
      setError("Please attach a Word, PDF, TXT, or image file.");
      e.target.value = "";
      setFileName("");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("That file is too large (max 10MB).");
      e.target.value = "";
      setFileName("");
      return;
    }
    setFileName(f.name);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const res = await fetch("/api/quote", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: "Something went wrong." }));
        throw new Error(body.message ?? "Something went wrong. Please try WhatsApp.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try WhatsApp.");
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-gold-400/30 bg-ink-850/60 p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gold-400/15 text-gold-300">
          <svg viewBox="0 0 20 20" className="h-6 w-6" fill="none" aria-hidden>
            <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="text-2xl font-semibold text-slate-100">Request received</h2>
        <p className="mx-auto mt-3 max-w-md text-slate-300">
          Thank you — our team will review your brief and get back to you with a quote on WhatsApp or email. Nothing is
          charged until you approve.
        </p>
        <a
          href={whatsappLink("Hi! I just submitted a quote request.")}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex min-h-[44px] items-center rounded-full border border-gold-400/50 px-6 text-sm font-semibold text-gold-300 transition hover:bg-gold-400/10"
        >
          Message us on WhatsApp
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-white/8 bg-ink-850/60 p-6 shadow-card sm:p-8" noValidate>
      {/* Honeypot — visually hidden; bots fill it, humans don't. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Leave this empty</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelCls} htmlFor="name">Your name</label>
          <input id="name" name="name" required maxLength={120} className={fieldCls} placeholder="Full name" />
        </div>
        <div>
          <label className={labelCls} htmlFor="email">Email</label>
          <input id="email" name="email" type="email" required maxLength={160} className={fieldCls} placeholder="you@example.com" />
        </div>
        <div>
          <label className={labelCls} htmlFor="phone">WhatsApp / phone</label>
          <input id="phone" name="phone" maxLength={40} className={fieldCls} placeholder="+8801…" />
        </div>
        <div>
          <label className={labelCls} htmlFor="country">Country</label>
          <input id="country" name="country" maxLength={80} className={fieldCls} placeholder="e.g. United Kingdom" />
        </div>
        <div>
          <label className={labelCls} htmlFor="service">Service</label>
          <select id="service" name="service" className={fieldCls} defaultValue="">
            <option value="" disabled>Choose a service…</option>
            {services.map((s) => (
              <option key={s.title} value={s.title}>{s.title}</option>
            ))}
            <option value="Other">Something else</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="level">Academic level</label>
          <select id="level" name="level" className={fieldCls} defaultValue="">
            <option value="">Optional…</option>
            <option>High school</option>
            <option>Undergraduate</option>
            <option>Master&apos;s</option>
            <option>PhD / Doctoral</option>
            <option>Professional</option>
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="deadline">Deadline</label>
          <input id="deadline" name="deadline" maxLength={80} className={fieldCls} placeholder="e.g. 2 weeks / 30 Aug" />
        </div>
        <div>
          <label className={labelCls} htmlFor="wordCount">Approx. word count</label>
          <input id="wordCount" name="wordCount" inputMode="numeric" maxLength={40} className={fieldCls} placeholder="e.g. 3000" />
        </div>
      </div>

      <div className="mt-4">
        <label className={labelCls} htmlFor="details">Tell us what you need</label>
        <textarea id="details" name="details" required maxLength={5000} rows={5} className={fieldCls} placeholder="Topic, requirements, instructions, referencing style…" />
      </div>

      <div className="mt-4">
        <label className={labelCls} htmlFor="file">Attach a brief (optional)</label>
        <input
          id="file"
          name="file"
          type="file"
          accept={ACCEPT}
          onChange={pickFile}
          className="block w-full text-sm text-slate-400 file:mr-4 file:rounded-full file:border-0 file:bg-gold-400/15 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gold-300 hover:file:bg-gold-400/25"
        />
        <p className="mt-1.5 text-xs text-slate-500">Word, PDF, TXT, or image — max 10MB. {fileName && `Selected: ${fileName}`}</p>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">
          {error}
        </p>
      )}

      <p className="mt-4 text-xs text-slate-500">
        No payment is taken here. We&apos;ll review your request and send a quote — you decide whether to proceed.
      </p>

      <button
        type="submit"
        disabled={busy}
        className="mt-5 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-gold-400 px-6 text-sm font-semibold text-ink-950 shadow-glow transition hover:bg-gold-300 disabled:opacity-60"
      >
        {busy ? "Sending…" : "Send my request"}
      </button>
    </form>
  );
}
