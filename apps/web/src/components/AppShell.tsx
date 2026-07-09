"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { useApi, logout } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { Button, cx } from "./ui";
import { NotificationBell } from "./NotificationBell";

/**
 * App shell (UI_AUDIT R8). A grouped, collapsible LEFT SIDEBAR (rubric's data-heavy
 * pattern) with active-state, replacing the old 23-link horizontal overflow bar; a
 * WIDER content area (max-w-6xl) so money tables aren't cramped; auto-breadcrumbs
 * from the path; and a mobile hamburger drawer. Links are permission-gated exactly
 * as before (same `can(perms, "module:action")`), and a group hides when the user
 * can see none of its items.
 */
type NavItem = { href: string; label: string; perm: string | null };
const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Work",
    items: [
      { href: "/tasks", label: "Tasks", perm: "capture:view" },
      { href: "/capture", label: "AI capture", perm: "ai_capture:create" },
      { href: "/outcomes", label: "Outcomes", perm: "outcomes:view" },
      { href: "/resit", label: "Resit", perm: "work:approve" },
      { href: "/checks", label: "Checks", perm: "checks:view" },
      { href: "/knowledge", label: "Knowledge", perm: "knowledge:view" },
      { href: "/cover-sheets", label: "Cover sheets", perm: "knowledge:view" },
      { href: "/custom-fields", label: "Custom fields", perm: "custom_fields:view" },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/invoices", label: "Invoices", perm: "billing:view" },
      { href: "/payments", label: "Payments", perm: "billing:view" },
      { href: "/settlement", label: "Settlement", perm: "billing:view" },
      { href: "/expenses", label: "Expenses", perm: "expenses:view" },
      { href: "/advances", label: "Advances", perm: "advances:view" },
      { href: "/balance", label: "Balance", perm: null }, // universal — own two-way position
    ],
  },
  {
    title: "Directory",
    items: [
      { href: "/clients", label: "Clients", perm: "reference:view" },
      { href: "/vault", label: "Vault", perm: "credential_vault:view" },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", perm: "dashboard:view" },
      { href: "/data", label: "Data", perm: "import_export:view" },
    ],
  },
  {
    title: "Mine",
    items: [
      { href: "/channels/mine", label: "My share", perm: "channels:view" },
      { href: "/referrers/me", label: "My referrals", perm: "referrers:view" },
      { href: "/vendor/me", label: "My invoices", perm: "vendor:create" },
      { href: "/employee/log", label: "My work log", perm: "hrm:create" },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/referrers", label: "Referrers", perm: "referrers:approve" },
      { href: "/channels", label: "Channels", perm: "channels:approve" },
      { href: "/client-admin", label: "Client portal", perm: "client_portal:view" },
      { href: "/vendor-admin", label: "Vendor claims", perm: "vendor:approve" },
      { href: "/hrm", label: "Work logs", perm: "hrm:approve" },
      { href: "/roles", label: "Roles", perm: "platform:view" }, // SuperAdmin-only (Admins lack platform)
    ],
  },
];

const looksLikeId = (s: string) => /^[0-9a-f-]{16,}$/i.test(s) || /^\d+$/.test(s);
const titleCase = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

function Breadcrumbs({ pathname }: { pathname: string }) {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const crumbs = segs.map((seg, i) => ({
    href: "/" + segs.slice(0, i + 1).join("/"),
    label: looksLikeId(seg) ? "Detail" : titleCase(seg),
  }));
  return (
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-gray-400">
      <Link href="/" className="hover:text-gray-700">Home</Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          <span>/</span>
          {i === crumbs.length - 1 ? (
            <span className="text-gray-600">{c.label}</span>
          ) : (
            <Link href={c.href} className="hover:text-gray-700">{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const pathname = usePathname() ?? "/";
  const [drawer, setDrawer] = useState(false);
  const perms = me?.permissions;

  const groups = NAV.map((g) => ({
    ...g,
    items: g.items.filter((it) => it.perm === null || can(perms, it.perm)),
  })).filter((g) => g.items.length > 0);

  // Highlight the SINGLE most-specific matching item (so /channels/mine highlights
  // "My share", not also "Channels" via a prefix match).
  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((it) => pathname === it.href || pathname.startsWith(it.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === activeHref;

  const sidebar = (
    <nav className="space-y-4">
      <Link href="/" className="block px-3 text-sm font-semibold tracking-tight" onClick={() => setDrawer(false)}>
        Business OS
      </Link>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                onClick={() => setDrawer(false)}
                aria-current={isActive(it.href) ? "page" : undefined}
                className={cx(
                  "block rounded-lg px-3 py-1.5 text-sm",
                  isActive(it.href) ? "bg-gray-900 font-medium text-white" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900",
                )}
              >
                {it.label}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* top strip */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded p-2 text-gray-600 hover:bg-gray-100 lg:hidden"
              aria-label="Open menu"
              onClick={() => setDrawer(true)}
            >
              <Menu aria-hidden className="h-5 w-5" />
            </button>
            <Link href="/" className="text-sm font-semibold tracking-tight lg:hidden">Business OS</Link>
          </div>
          <div className="flex items-center gap-3">
            {me?.party?.displayName && <span className="hidden text-xs text-gray-500 sm:inline">{me.party.displayName}</span>}
            {can(perms, "notifications:view") && <NotificationBell canBroadcast={can(perms, "notifications:approve")} />}
            <Button variant="ghost" className="px-2 text-xs" onClick={() => logout()}>Sign out</Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* desktop sidebar */}
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-60 shrink-0 overflow-y-auto border-r border-gray-200 bg-white py-4 lg:block">
          {sidebar}
        </aside>

        {/* mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
            <div className="absolute left-0 top-0 h-full w-64 overflow-y-auto bg-white py-4 shadow-lg">{sidebar}</div>
          </div>
        )}

        <main className="mx-auto w-full max-w-6xl px-4 py-5">
          <Breadcrumbs pathname={pathname} />
          {children}
        </main>
      </div>
    </div>
  );
}
