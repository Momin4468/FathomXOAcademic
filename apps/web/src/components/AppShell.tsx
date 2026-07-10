"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, Award, BarChart3, Banknote, BookOpen, Briefcase, ClipboardCheck, ClipboardList,
  Contact, Database, Download, FileText, Flag, Globe, HandCoins, KeyRound, LayoutDashboard, ListTodo, Menu,
  PackageCheck, PieChart, Plus, Radio, Receipt, RotateCcw, Scale, Share2, Shield, ShieldCheck,
  SlidersHorizontal, Sparkles, Users, UserPlus, Wallet, type LucideIcon,
} from "lucide-react";
import { useApi, logout } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { cx } from "./ui";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

/**
 * App shell. A FIXED dark ink-navy sidebar + header (the `nav` scale — never
 * themed), with a LIGHT (default) or dark (user toggle) main-content area. Every
 * nav item carries a consistent lucide icon. Groups read top-down as: the job
 * workflow (Work), the money ledgers (Money), directories, the doc library,
 * insights, the viewer's own numbers (Mine), and admin config.
 */
type NavItem = { href: string; label: string; perm: string | null; icon: LucideIcon };
const NAV: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "Work",
    items: [
      { href: "/", label: "Dashboard", perm: null, icon: LayoutDashboard },
      { href: "/work", label: "Jobs", perm: "work:view", icon: Briefcase },
      { href: "/work/new", label: "New job", perm: "work:create", icon: Plus },
      { href: "/tasks", label: "Tasks", perm: "capture:view", icon: ListTodo },
      { href: "/capture", label: "AI capture", perm: "ai_capture:create", icon: Sparkles },
      { href: "/resit", label: "Resit", perm: "work:approve", icon: RotateCcw },
    ],
  },
  {
    title: "Money",
    items: [
      { href: "/invoices", label: "Invoices", perm: "billing:view", icon: FileText },
      { href: "/payments", label: "Payments", perm: "billing:view", icon: Banknote },
      { href: "/settlement", label: "Settlement", perm: "billing:view", icon: ArrowLeftRight },
      { href: "/expenses", label: "Expenses", perm: "expenses:view", icon: Wallet },
      { href: "/advances", label: "Advances", perm: "advances:view", icon: HandCoins },
      { href: "/opening-balances", label: "Opening balances", perm: "billing:approve", icon: Flag },
      { href: "/checks", label: "Checks", perm: "checks:view", icon: ShieldCheck },
      { href: "/balance", label: "Balance", perm: null, icon: Scale },
    ],
  },
  {
    title: "Directory",
    items: [
      { href: "/clients", label: "Clients", perm: "reference:view", icon: Users },
      { href: "/people", label: "Team & partners", perm: "reference:view", icon: Contact },
      { href: "/reference-data", label: "Academic", perm: "reference:view", icon: Database },
    ],
  },
  {
    title: "Insights",
    items: [
      { href: "/analytics", label: "Analytics", perm: "dashboard:view", icon: BarChart3 },
      { href: "/data", label: "Data", perm: "import_export:view", icon: Download },
    ],
  },
  {
    title: "Mine",
    items: [
      { href: "/channels/mine", label: "My share", perm: "channels:view", icon: PieChart },
      { href: "/referrers/me", label: "My referrals", perm: "referrers:view", icon: Share2 },
      { href: "/vendor/me", label: "My invoices", perm: "vendor:create", icon: Receipt },
      { href: "/employee/log", label: "My work log", perm: "hrm:create", icon: ClipboardList },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/custom-fields", label: "Custom fields", perm: "custom_fields:view", icon: SlidersHorizontal },
      { href: "/channels", label: "Channels", perm: "channels:approve", icon: Radio },
      { href: "/referrers", label: "Referrers", perm: "referrers:approve", icon: UserPlus },
      { href: "/outcomes", label: "Outcomes", perm: "outcomes:view", icon: Award },
      { href: "/hrm", label: "Work logs", perm: "hrm:approve", icon: ClipboardCheck },
      { href: "/vault", label: "Vault", perm: "credential_vault:view", icon: KeyRound },
      { href: "/knowledge", label: "Knowledge", perm: "knowledge:view", icon: BookOpen },
      { href: "/cover-sheets", label: "Cover sheets", perm: "knowledge:view", icon: FileText },
      { href: "/client-admin", label: "Client portal", perm: "client_portal:view", icon: Globe },
      { href: "/vendor-admin", label: "Vendor claims", perm: "vendor:approve", icon: PackageCheck },
      { href: "/roles", label: "Roles", perm: "platform:view", icon: Shield },
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
    <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1 text-xs text-slate-400">
      <Link href="/" className="hover:text-slate-200">Home</Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          <span>/</span>
          {i === crumbs.length - 1 ? (
            <span className="text-slate-300">{c.label}</span>
          ) : (
            <Link href={c.href} className="hover:text-slate-200">{c.label}</Link>
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
      <Link href="/" className="block px-3" onClick={() => setDrawer(false)}>
        <Logo onDark />
      </Link>
      {groups.map((g) => (
        <div key={g.title}>
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-nav-muted">{g.title}</p>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setDrawer(false)}
                  aria-current={isActive(it.href) ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm",
                    isActive(it.href)
                      ? "bg-gold-400 font-medium text-ink-950"
                      : "text-nav-text hover:bg-nav-hover hover:text-nav-bright",
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  {it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen bg-ink-900">
      {/* top strip (always dark) */}
      <header className="sticky top-0 z-20 border-b border-nav-border bg-nav-surface">
        <div className="flex h-12 items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded p-2 text-nav-text hover:bg-nav-hover hover:text-nav-bright lg:hidden"
              aria-label="Open menu"
              onClick={() => setDrawer(true)}
            >
              <Menu aria-hidden className="h-5 w-5" />
            </button>
            <Link href="/" className="lg:hidden"><Logo onDark compact /></Link>
          </div>
          <div className="flex items-center gap-2">
            {me?.party?.displayName && <span className="hidden text-xs text-nav-muted sm:inline">{me.party.displayName}</span>}
            <ThemeToggle />
            {can(perms, "notifications:view") && <NotificationBell canBroadcast={can(perms, "notifications:approve")} />}
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-lg px-2 py-1.5 text-xs text-nav-text hover:bg-nav-hover hover:text-nav-bright"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* desktop sidebar (always dark) */}
        <aside className="sticky top-12 hidden h-[calc(100vh-3rem)] w-60 shrink-0 overflow-y-auto border-r border-nav-border bg-nav-surface py-4 lg:block">
          {sidebar}
        </aside>

        {/* mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
            <div className="absolute left-0 top-0 h-full w-64 overflow-y-auto border-r border-nav-border bg-nav-surface py-4 shadow-lg">{sidebar}</div>
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
