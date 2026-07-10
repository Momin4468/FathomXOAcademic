"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePfApi, pfLogout } from "@/lib/pf-api";
import type { PfProfile } from "@/lib/pf-types";
import { Button, cx } from "./ui";
import { PfQuickAdd } from "./PfQuickAdd";

const LINKS = [
  { href: "/personal-finance", label: "Overview" },
  { href: "/personal-finance/income", label: "Income" },
  { href: "/personal-finance/expenses", label: "Expenses" },
  { href: "/personal-finance/loans", label: "Loans" },
  { href: "/personal-finance/savings", label: "Savings" },
  { href: "/personal-finance/investments", label: "Investments" },
  { href: "/personal-finance/cash", label: "Cash check-in" },
  { href: "/personal-finance/targets", label: "Targets" },
  { href: "/personal-finance/subscriptions", label: "Subscriptions" },
  { href: "/personal-finance/notes", label: "Notes" },
  { href: "/personal-finance/categories", label: "Categories" },
  { href: "/personal-finance/connect", label: "Connect income" },
  { href: "/personal-finance/settings", label: "Settings" },
];

/**
 * The Personal Finance shell (§11) — a self-contained, visibly-private section
 * with its OWN session. An emerald accent distinguishes it from the business app.
 */
export function PfShell({ children }: { children: React.ReactNode }) {
  const { data: me } = usePfApi<PfProfile>("auth/me");
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-ink-900">
      <header className="sticky top-0 z-10 border-b border-emerald-500/20 bg-ink-850">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
            <Link href="/personal-finance" className="font-semibold tracking-tight text-emerald-700 dark:text-emerald-300">
              Personal Finance
            </Link>
            {LINKS.slice(1).map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cx(
                  "hover:text-slate-100",
                  pathname === l.href ? "text-emerald-700 dark:text-emerald-300 font-medium" : "text-slate-400",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {me?.displayName && <span className="hidden text-xs text-slate-400 sm:inline">{me.displayName}</span>}
            <Button variant="ghost" className="px-2 text-xs" onClick={() => pfLogout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5 pb-24">{children}</main>
      <PfQuickAdd />
    </div>
  );
}
