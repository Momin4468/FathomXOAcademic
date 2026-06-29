"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clientLogout, useClientApi } from "@/lib/client-api";
import { Button, cx } from "@/components/ui";

interface ClientProfile {
  displayName: string | null;
  loginId: string;
}

const LINKS = [
  { href: "/portal", label: "My requests" },
  { href: "/portal/requests/new", label: "Submit a request" },
  { href: "/portal/messages", label: "Messages" },
];

/** The scoped shell for the client portal plane (Module 18). Distinct sky accent
 *  so it reads as a separate, client-facing surface (not the business app). */
export function ClientPortalShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useClientApi<ClientProfile>("auth/me");
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-sky-50/40">
      <header className="sticky top-0 z-10 border-b border-sky-100 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
            <Link href="/portal" className="font-semibold tracking-tight text-sky-800">
              Client portal
            </Link>
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={cx(
                  "hover:text-gray-900",
                  pathname === l.href ? "font-medium text-gray-900" : "text-gray-600",
                )}
              >
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {me?.displayName && <span className="hidden text-xs text-gray-500 sm:inline">{me.displayName}</span>}
            <Button variant="ghost" className="px-2 text-xs" onClick={() => clientLogout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  );
}
