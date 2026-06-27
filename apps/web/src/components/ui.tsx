import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { formatMoney } from "@/lib/format";

export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

// ─── Button ──────────────────────────────────────────────────────────────────
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};
export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  const styles = {
    primary: "bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400",
    secondary: "border border-gray-300 text-gray-800 hover:bg-gray-50",
    ghost: "text-gray-600 hover:bg-gray-100",
    danger: "border border-red-300 text-red-700 hover:bg-red-50",
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
        "min-h-[44px] w-full rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900",
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
        "min-h-[88px] w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900",
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
        "min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {children}
      {hint && !error && <span className="block text-xs text-gray-400">{hint}</span>}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

// ─── Card / Badge ────────────────────────────────────────────────────────────
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("rounded-xl border border-gray-200 bg-white p-4", className)}>{children}</div>;
}

const BADGE_TONES: Record<string, string> = {
  gray: "bg-gray-100 text-gray-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-800",
  green: "bg-green-100 text-green-700",
  red: "bg-red-100 text-red-700",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof BADGE_TONES | string; children: ReactNode }) {
  return (
    <span className={cx("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", BADGE_TONES[tone] ?? BADGE_TONES.gray)}>
      {children}
    </span>
  );
}

/** Map a work/money state to a badge tone (consistent across screens). */
export function StateBadge({ state }: { state: string }) {
  const tone =
    { draft: "gray", pending: "amber", confirmed: "blue", delivered: "green", unbilled: "gray", invoiced: "amber", partial: "amber", settled: "green" }[
      state
    ] ?? "gray";
  return <Badge tone={tone}>{state}</Badge>;
}

// ─── States ──────────────────────────────────────────────────────────────────
export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <p className="py-8 text-center text-sm text-gray-400">{label}</p>;
}
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
export function ErrorNote({ message }: { message: string }) {
  return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>;
}

/**
 * THE money component. Renders an amount ONLY when the value is present. The API
 * redacts money the caller can't see, so an absent value renders NOTHING here —
 * the single place "absent ⇒ hidden" is enforced in the UI. Never invent a 0/—.
 */
export function Money({ value, prefix = "৳" }: { value: number | string | null | undefined; prefix?: string }) {
  const formatted = formatMoney(value, prefix);
  if (formatted === null) return null;
  return <span className="tabular-nums">{formatted}</span>;
}
