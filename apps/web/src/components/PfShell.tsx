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
 * The Personal Finance shell (§11) — a self-contained, visibly-PRIVATE plane with
 * its OWN session. A distinct teal identity (never the business gold/navy) makes
 * the walled-off boundary unmistakable: business (even SuperAdmin) reads zero here.
 */
export function PfShell({ children }: { children: React.ReactNode }) {
  const { data: me } = usePfApi<PfProfile>("auth/me");
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-ink-900">
      <header className="sticky top-0 z-10 border-b border-pf-accent/20 bg-gradient-to-r from-pf-900 to-pf-700">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
            <Link href="/personal-finance" className="flex items-center gap-1.5 font-semibold tracking-tight text-pf-accent">
              <span aria-hidden className="h-2 w-2 rounded-full bg-pf-accent" />
              Personal Finance
            </Link>
            {LINKS.slice(1).map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cx(
                  "hover:text-pf-accent",
                  pathname === l.href ? "font-medium text-pf-accent" : "text-pf-accent/60",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {me?.displayName && <span className="hidden text-xs text-pf-accent/70 sm:inline">{me.displayName}</span>}
            <Button variant="ghost" className="px-2 text-xs text-pf-accent/80 hover:text-pf-accent" onClick={() => pfLogout()}>
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
