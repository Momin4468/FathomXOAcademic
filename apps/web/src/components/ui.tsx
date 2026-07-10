"use client";
import { useEffect, useState } from "react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { CURRENCIES } from "@business-os/shared";
import { displayAmount, formatDateTime, formatMoney, sanitizeAmount } from "@/lib/format";

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

// ─── Button ──────────────────────────────────────────────────────────────────
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};
export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-gold-400 text-ink-950 hover:bg-gold-300 disabled:bg-ink-700 disabled:text-slate-400",
    secondary: "border border-ink-700 text-slate-200 hover:bg-ink-800",
    ghost: "text-slate-300 hover:bg-ink-800",
    danger: "border border-red-500/40 text-red-300 hover:bg-red-500/10",
  }[variant];
  return (
    <button
      className={cx(
        "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60",
        styles,
        className,
      )}
      {...props}
    />
  );
}

// ─── Input / Select / Field ──────────────────────────────────────────────────
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "min-h-[44px] w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400",
        className,
      )}
      {...props}
    />
  );
}
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cx(
        "min-h-[88px] w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400",
        className,
      )}
      {...props}
    />
  );
}
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "min-h-[44px] w-full rounded-lg border border-ink-700 bg-ink-850 px-3 text-sm text-slate-100 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
/**
 * Money entry control (UI_AUDIT R1). A text input (never `type="number"`, so NO
 * spinner arrows), right-aligned + tabular, with a currency adornment. Formats
 * thousand separators + 2 decimals on blur; while focused it shows the raw number
 * for easy editing. Emits the bare numeric string via onChange (parent does
 * `Number(v)`), so a pasted "৳1,500.50" is captured cleanly. Keyboard-first —
 * arrow keys don't increment.
 */
export function MoneyInput({
  value,
  onChange,
  currency = "৳",
  allowNegative = false,
  className,
  onFocus,
  onBlur,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  currency?: string;
  allowNegative?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(value ?? "");
  const [focused, setFocused] = useState(false);
  // Re-sync when the parent resets/sets the value while we're not editing.
  useEffect(() => {
    if (!focused) setText(value ?? "");
  }, [value, focused]);

  const display = focused ? text : displayAmount(text);
  // Keep the adornment to a compact symbol so a 3-letter code doesn't overrun.
  const symbol = ({ BDT: "৳", USD: "$", GBP: "£", EUR: "€", AUD: "A$" } as Record<string, string>)[currency] ?? currency;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-slate-400">{symbol}</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        // Chain a caller-supplied onFocus/onBlur (e.g. an amount clamp) with the
        // internal focus tracking, so both the guard AND the blur-reformat run.
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        onChange={(e) => {
          const t = sanitizeAmount(e.target.value, allowNegative);
          setText(t);
          onChange(t);
        }}
        className={cx(
          "min-h-[44px] w-full rounded-lg border border-ink-700 bg-ink-850 pl-7 pr-3 text-right text-sm tabular-nums text-slate-100 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400",
          className,
        )}
        {...rest}
      />
    </div>
  );
}

/** Percentage entry (R1): text input, right-aligned, `%` suffix, no spinners. */
export function PercentInput({
  value,
  onChange,
  className,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        // Reuse the money sanitizer so a percent can't hold multiple dots (→ NaN).
        onChange={(e) => onChange(sanitizeAmount(e.target.value))}
        className={cx(
          "min-h-[44px] w-full rounded-lg border border-ink-700 bg-ink-850 pl-3 pr-7 text-right text-sm tabular-nums text-slate-100 outline-none focus:border-gold-400 focus:ring-1 focus:ring-gold-400",
          className,
        )}
        {...rest}
      />
      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-slate-400">%</span>
    </div>
  );
}

/** Currency picker (R1) — sits beside a MoneyInput for multi-currency capture. */
export function CurrencySelect({
  value,
  onChange,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "children">) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}

/** Curated IANA zones (spec §8: UK / Melbourne / Sydney / Dhaka) + UTC. */
export const TZ_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Asia/Dhaka", label: "Dhaka" },
  { value: "Europe/London", label: "UK (London)" },
  { value: "Australia/Melbourne", label: "Melbourne" },
  { value: "Australia/Sydney", label: "Sydney" },
  { value: "America/New_York", label: "New York" },
  { value: "UTC", label: "UTC" },
];
export const tzLabel = (tz: string | null | undefined): string =>
  TZ_OPTIONS.find((z) => z.value === tz)?.label ?? tz ?? "";

/** A date picker (native, never free text). Value is yyyy-mm-dd. */
export function DateInput({ value, onChange, ...props }: { value: string; onChange: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} {...props} />;
}

/** Deadline picker: date + time + IANA zone. Stored as an absolute instant + tz. */
export function DateTimeTzInput({
  value,
  onChange,
}: {
  value: { date: string; time: string; tz: string };
  onChange: (v: { date: string; time: string; tz: string }) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      <Input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
      <Input type="time" value={value.time} onChange={(e) => onChange({ ...value, time: e.target.value })} />
      <Select value={value.tz} onChange={(e) => onChange({ ...value, tz: e.target.value })}>
        {TZ_OPTIONS.map((z) => (
          <option key={z.value} value={z.value}>
            {z.label}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  /** Show a red `*` after the label for a genuinely-required field. */
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-300">
        {label}
        {required && <span className="ml-0.5 text-red-400" aria-hidden>*</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-xs text-slate-400">{hint}</span>}
      {error && <span className="block text-xs text-red-400">{error}</span>}
    </label>
  );
}

// ─── Card / Badge ────────────────────────────────────────────────────────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-ink-700 bg-ink-850 p-4 text-slate-200", className)}>{children}</div>;
}

/**
 * Expandable section (native <details>) — the "common fields shown, the rest in
 * expandable groups" pattern for overloaded forms, so a long form isn't one wall
 * of inputs. Reused by the job form and anywhere else a form gets heavy.
 */
export function Collapsible({ title, hint, defaultOpen, children }: { title: string; hint?: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-ink-700 bg-ink-900/40">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2 text-sm font-medium text-slate-200 [&::-webkit-details-marker]:hidden">
        <span className="text-slate-500 transition group-open:rotate-90">▸</span>
        {title}
        {hint && <span className="ml-auto text-xs font-normal text-slate-500">{hint}</span>}
      </summary>
      <div className="space-y-4 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}

const BADGE_TONES: Record<string, string> = {
  gray: "bg-ink-700 text-slate-300",
  blue: "bg-blue-500/15 text-blue-300",
  amber: "bg-amber-500/15 text-amber-300",
  green: "bg-emerald-500/15 text-emerald-300",
  red: "bg-red-500/15 text-red-300",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof BADGE_TONES | string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", BADGE_TONES[tone] ?? BADGE_TONES.gray)}>
      {children}
    </span>
  );
}

/** Map a work / money / invoice state to a badge tone (consistent across screens). */
export function StateBadge({ state }: { state: string }) {
  const tone =
    {
      // work-state
      draft: "gray", pending: "amber", confirmed: "blue", delivered: "green",
      // work_line line-status (Phase 4A): draft→pending→submitted→billed, or cancelled
      submitted: "blue", billed: "green", cancelled: "red",
      // money-state
      unbilled: "gray", invoiced: "amber", partial: "amber", settled: "green",
      // invoice status
      open: "gray", sent: "blue", paid: "green", void: "red",
      // check-batch status (proposed claim → confirmed)
      proposed: "amber",
    }[state] ?? "gray";
  return <Badge tone={tone}>{state}</Badge>;
}

// ─── States ──────────────────────────────────────────────────────────────────
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-slate-400">{label}</p>;
}
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}
export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{message}</p>;
}

/**
 * THE money component. Renders an amount ONLY when the value is present. The API
 * redacts money the caller can't see, so an absent value renders NOTHING here —
 * the single place "absent ⇒ hidden" is enforced in the UI. Never invent a 0/—.
 */
export function Money({
  value,
  prefix = "৳",
  signed = false,
}: {
  value: number | string | null | undefined;
  prefix?: string;
  /** Finance convention (R7): render a negative in red + (parentheses). */
  signed?: boolean;
}) {
  const n = value === null || value === undefined || value === "" ? NaN : Number(value);
  const negative = signed && !Number.isNaN(n) && n < 0;
  // For a signed negative, format the magnitude and wrap it in parentheses.
  const formatted = formatMoney(negative ? Math.abs(n) : value, prefix);
  if (formatted === null) return null;
  return <span className={cx("tabular-nums", negative && "text-red-400")}>{negative ? `(${formatted})` : formatted}</span>;
}

/**
 * Audit-trail line (UI_AUDIT R5) — "Created by <name> · <when>" (+ updated/confirmed
 * when present) on a financial/governance record. A null actor shows "—"; a line
 * with neither a name nor a date is dropped. Names are resolved server-side.
 */
export function Provenance({ items }: { items: Array<{ label: string; name?: string | null; at?: string | null }> }) {
  const shown = items.filter((i) => i.name || i.at);
  if (shown.length === 0) return null;
  return (
    <div className="mt-3 space-y-0.5 border-t border-ink-700 pt-2 text-xs text-slate-400">
      {shown.map((i) => (
        <div key={i.label}>
          {i.label} <span className="text-slate-200">{i.name ?? "—"}</span>
          {i.at ? ` · ${formatDateTime(i.at)}` : ""}
        </div>
      ))}
    </div>
  );
}
