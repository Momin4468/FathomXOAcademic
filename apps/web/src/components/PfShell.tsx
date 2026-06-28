"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePfApi, pfLogout } from "@/lib/pf-api";
import type { PfProfile } from "@/lib/pf-types";
import { Button, cx } from "./ui";

const LINKS = [
  { href: "/personal-finance", label: "Overview" },
  { href: "/personal-finance/income", label: "Income" },
  { href: "/personal-finance/expenses", label: "Expenses" },
  { href: "/personal-finance/loans", label: "Loans" },
  { href: "/personal-finance/savings", label: "Savings" },
  { href: "/personal-finance/targets", label: "Targets" },
  { href: "/personal-finance/subscriptions", label: "Subscriptions" },
  { href: "/personal-finance/notes", label: "Notes" },
  { href: "/personal-finance/categories", label: "Categories" },
  { href: "/personal-finance/connect", label: "Connect income" },
];

/**
 * The Personal Finance shell (§11) — a self-contained, visibly-private section
 * with its OWN session. An emerald accent distinguishes it from the business app.
 */
export function PfShell({ children }: { children: React.ReactNode }) {
  const { data: me } = usePfApi<PfProfile>("auth/me");
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-emerald-50/40">
      <header className="sticky top-0 z-10 border-b border-emerald-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
            <Link href="/personal-finance" className="font-semibold tracking-tight text-emerald-800">
              Personal Finance
            </Link>
            {LINKS.slice(1).map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cx(
                  "hover:text-gray-900",
                  pathname === l.href ? "text-gray-900 font-medium" : "text-gray-600",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {me?.displayName && <span className="hidden text-xs text-gray-500 sm:inline">{me.displayName}</span>}
            <Button variant="ghost" className="px-2 text-xs" onClick={() => pfLogout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  );
}
