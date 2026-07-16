"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowLeftRight, Award, BarChart3, Banknote, BookOpen, ClipboardCheck, ClipboardList,
  Contact, Database, Download, Eye, FileText, Flag, Globe, HandCoins, KeyRound, Landmark, LayoutDashboard, ListTodo, LogOut, Menu,
  PackageCheck, PanelLeft, PieChart, Plus, Radio, Receipt, RotateCcw, Scale, Search, Settings, Share2, Shield, ShieldCheck,
  SlidersHorizontal, Sparkles, UserCog, Users, UserPlus, Wallet, X, type LucideIcon,
} from "lucide-react";
import { apiGet, useApi, logout } from "@/lib/api";
import { can, type PartyRow, type RefEntity, type WhoAmI } from "@/lib/types";
import { cx } from "./ui";
import { EntityPicker, type PickItem } from "./EntityPicker";
import { Logo } from "./Logo";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "./ThemeToggle";

// ── "View as" cookie helpers (a plain UI cookie the BFF forwards as x-view-as) ──
const readCookie = (name: string): string | null => {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
};
const setViewAsCookie = (id: string) => { document.cookie = `view-as=${encodeURIComponent(id)}; path=/; samesite=lax`; };
const clearViewAsCookie = () => { document.cookie = "view-as=; path=/; max-age=0"; };

/** Persona for a previewed party — chosen from its type (nav tree re-scopes to it). */
function personaFromType(types: string[] | undefined): Persona {
  const t = types ?? [];
  if (t.includes("vendor")) return "vendor";
  if (t.includes("partner")) return "partner";
  if (t.includes("referrer")) return "referrer";
  if (t.includes("employee")) return "employee";
  return "writer";
}

/**
 * App shell. A FIXED dark ink-navy sidebar + header (the `nav` scale — never
 * themed), with a LIGHT (default) or dark (user toggle) main-content area. Per the
 * design handoff, the nav is now PER-ROLE: the viewer's persona (resolved from
 * their roles/permissions) selects a grouped tree, and every item is still
 * permission-filtered as a backstop so the tree can never over-expose. The top bar
 * carries global search, a gold "+ New" quick-add, notifications, and an avatar menu.
 */
type NavItem = { href: string; label: string; perm: string | null; icon: LucideIcon };
type NavGroup = { title: string; items: NavItem[] };

// ── Persona: which of the handoff's role trees the viewer sees ────────────────
type Persona = "owner" | "admin" | "writer" | "partner" | "referrer" | "vendor" | "employee";

/**
 * Resolve the viewer's persona from their roles/permissions (roles are data, so
 * this reads capabilities, not a hardcoded name). The nav tree is then still
 * permission-filtered, so a mis-resolved persona can only ever show LESS.
 */
function resolvePersona(me: WhoAmI | undefined): Persona {
  if (!me) return "writer";
  const roles = me.roleNames.map((r) => r.toLowerCase());
  const has = (p: string) => me.permissions.includes(p);
  if (me.principal.isSystemSuperadmin) return "owner";
  if (has("work:approve") || has("billing:approve")) return "admin";
  if (roles.some((r) => r.includes("vendor")) || has("vendor:create")) return "vendor";
  if (roles.some((r) => r.includes("partner")) || has("channels:view")) return "partner";
  if (roles.some((r) => r.includes("referrer")) || has("referrers:view")) return "referrer";
  if (has("hrm:create") && !has("work:create")) return "employee";
  return "writer";
}

// Shared item builders (real routes; new screens are added as they land).
const I = {
  dashboard: { href: "/", label: "Dashboard", perm: null, icon: LayoutDashboard } as NavItem,
  profile: { href: "/profile", label: "Profile", perm: null, icon: Contact } as NavItem,
  knowledge: { href: "/knowledge", label: "Knowledge", perm: "knowledge:view", icon: BookOpen } as NavItem,
  clients: { href: "/clients", label: "Clients", perm: "reference:view", icon: Users } as NavItem,
};

// Owner & Admin share a tree; permission-filtering trims the Admin group for a
// non-platform admin (e.g. Emon lacks platform:view → no Users/Roles).
const ADMIN_TREE: NavGroup[] = [
  { title: "Work", items: [
    I.dashboard,
    { href: "/pending", label: "Pending", perm: "work:view", icon: Flag },
    { href: "/work", label: "Tasks", perm: "work:view", icon: ListTodo },
    { href: "/completed", label: "Completed", perm: "work:view", icon: ClipboardCheck },
    { href: "/approvals", label: "Approvals", perm: "reference:view", icon: ClipboardCheck },
    { href: "/work/new", label: "New task", perm: "work:create", icon: Plus },
    { href: "/capture", label: "AI capture", perm: "ai_capture:create", icon: Sparkles },
    { href: "/resit", label: "Resit", perm: "work:approve", icon: RotateCcw },
  ] },
  { title: "Money", items: [
    { href: "/cashbook", label: "Cashbook", perm: "billing:view", icon: Landmark },
    { href: "/invoices", label: "Invoices", perm: "billing:view", icon: FileText },
    { href: "/payments", label: "Payments", perm: "billing:view", icon: Banknote },
    { href: "/settlement", label: "Settlement", perm: "billing:view", icon: ArrowLeftRight },
    { href: "/expenses", label: "Expenses", perm: "expenses:view", icon: Wallet },
    { href: "/advances", label: "Advances", perm: "advances:view", icon: HandCoins },
    { href: "/opening-balances", label: "Opening balances", perm: "billing:approve", icon: Flag },
    { href: "/checks", label: "Checks", perm: "checks:view", icon: ShieldCheck },
    { href: "/balance", label: "Balance", perm: null, icon: Scale },
  ] },
  { title: "Clients & people", items: [
    I.clients,
    { href: "/people", label: "Team & partners", perm: "reference:view", icon: Contact },
    { href: "/reference-data", label: "Academic", perm: "reference:view", icon: Database },
  ] },
  { title: "Insights", items: [
    { href: "/analytics", label: "Analytics", perm: "dashboard:view", icon: BarChart3 },
    { href: "/data", label: "Data", perm: "import_export:view", icon: Download },
  ] },
  { title: "Library", items: [
    I.knowledge,
    { href: "/vault", label: "Vault", perm: "credential_vault:view", icon: KeyRound },
    { href: "/cover-sheets", label: "Cover sheets", perm: "knowledge:view", icon: FileText },
  ] },
  { title: "People ops", items: [
    { href: "/hrm", label: "Work logs", perm: "hrm:approve", icon: ClipboardCheck },
    { href: "/referrers", label: "Referrers", perm: "referrers:approve", icon: UserPlus },
    { href: "/channels", label: "Channels", perm: "channels:approve", icon: Radio },
    { href: "/outcomes", label: "Outcomes", perm: "outcomes:view", icon: Award },
  ] },
  { title: "Admin", items: [
    { href: "/client-admin", label: "Client portal", perm: "client_portal:view", icon: Globe },
    { href: "/vendor-admin", label: "Vendor claims", perm: "vendor:approve", icon: PackageCheck },
    { href: "/custom-fields", label: "Custom fields", perm: "custom_fields:view", icon: SlidersHorizontal },
    { href: "/users", label: "Users", perm: "platform:view", icon: UserCog },
    { href: "/roles", label: "Roles", perm: "platform:view", icon: Shield },
    { href: "/settings", label: "Settings", perm: "rules:view", icon: Settings },
  ] },
  { title: "Private", items: [
    { href: "/personal-finance", label: "Personal finance", perm: null, icon: PieChart },
  ] },
];

const NAV_BY_ROLE: Record<Persona, NavGroup[]> = {
  owner: ADMIN_TREE,
  admin: ADMIN_TREE,
  writer: [
    { title: "My work", items: [
      I.dashboard,
      { href: "/pending", label: "Pending", perm: "work:view", icon: Flag },
      { href: "/work", label: "My tasks", perm: "work:view", icon: ListTodo },
      { href: "/completed", label: "Completed", perm: "work:view", icon: ClipboardCheck },
    ] },
    { title: "Money", items: [
      { href: "/balance", label: "My earnings", perm: null, icon: Wallet },
      I.clients,
    ] },
    { title: "Library", items: [
      { href: "/vault", label: "Vault", perm: "credential_vault:view", icon: KeyRound },
      I.knowledge,
    ] },
    { title: "Account", items: [I.profile] },
  ],
  partner: [
    { title: "My space", items: [
      I.dashboard,
      { href: "/channels/mine", label: "My share", perm: "channels:view", icon: PieChart },
    ] },
    { title: "Directory", items: [I.clients, I.knowledge] },
    { title: "Account", items: [I.profile] },
  ],
  referrer: [
    { title: "My space", items: [
      I.dashboard,
      { href: "/referrers/me", label: "My referrals", perm: "referrers:view", icon: Share2 },
    ] },
    { title: "Account", items: [I.profile] },
  ],
  vendor: [
    { title: "My work", items: [
      I.dashboard,
      { href: "/work", label: "My jobs", perm: "work:view", icon: ListTodo },
    ] },
    { title: "Clients & money", items: [
      { href: "/clients", label: "My clients", perm: "reference:view", icon: Users },
      { href: "/vendor/me", label: "My statement", perm: "vendor:create", icon: Receipt },
    ] },
    { title: "Account", items: [I.profile] },
  ],
  employee: [
    { title: "My space", items: [
      I.dashboard,
      { href: "/employee/log", label: "My work log", perm: "hrm:create", icon: ClipboardList },
    ] },
    { title: "Library", items: [I.knowledge] },
    { title: "Account", items: [I.profile] },
  ],
};

const FOOTNOTE: Record<Persona, string> = {
  owner: "SuperAdmin: every leg, every real price. Personal finance stays private even from you.",
  admin: "Admin: your own clients & writers. Another owner's real client price is hidden from you.",
  writer: "You see your own tasks and earnings — never client prices or margins.",
  partner: "You see your own share only — never the pool or other partners.",
  referrer: "You see the works you referred and what you're owed — read-only.",
  vendor: "You bring work and pay what we ask — no margins, no writer pay shown.",
  employee: "Log your work — no price fields.",
};

const PERSONA_LABEL: Record<Persona, string> = {
  owner: "SuperAdmin · owner", admin: "Admin", writer: "Writer", partner: "Partner · profit-share",
  referrer: "Referrer", vendor: "Vendor", employee: "Employee",
};

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

/** Global search — fans out to existing RLS-scoped endpoints (clients/people + course codes). */
type Hit = { href: string; label: string; sub: string };
function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const [parties, courses] = await Promise.all([
          apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(term)}`).catch(() => [] as PartyRow[]),
          apiGet<RefEntity[]>(`reference?kind=course&q=${encodeURIComponent(term)}`).catch(() => [] as RefEntity[]),
        ]);
        if (cancelled) return;
        const next: Hit[] = [
          ...parties.slice(0, 6).map((p) => {
            const isClient = (p.partyType ?? []).includes("client");
            return { href: isClient ? `/clients/${p.id}` : `/people/${p.id}`, label: p.displayName, sub: (p.partyType ?? []).join(", ") || "party" };
          }),
          ...courses.slice(0, 5).map((c) => ({ href: `/reference-data`, label: c.canonical, sub: "course code" })),
        ];
        setHits(next);
      } catch { /* non-fatal */ }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={boxRef} className="relative hidden max-w-sm flex-1 sm:block">
      <div className="flex items-center gap-2 rounded-lg border border-nav-border bg-nav-bg px-3 py-1.5 text-nav-muted focus-within:border-gold-400">
        <Search aria-hidden className="h-4 w-4 shrink-0" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search clients, people, course codes…"
          className="w-full bg-transparent text-sm text-nav-bright placeholder:text-nav-muted focus:outline-none"
        />
      </div>
      {open && hits.length > 0 && (
        <div className="absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-lg">
          {hits.map((h) => (
            <button key={`${h.href}:${h.label}`} type="button"
              onClick={() => { setOpen(false); setQ(""); router.push(h.href); }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-ink-800">
              <span className="truncate font-medium text-slate-100">{h.label}</span>
              <span className="shrink-0 text-xs text-slate-500">{h.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Gold "+ New" quick-add popover (task / client). */
function QuickAdd() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-bold text-ink-950 hover:bg-gold-300">
        <Plus aria-hidden className="h-4 w-4" /> New
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-44 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 py-1 shadow-lg">
          <Link href="/work/new" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-ink-800"><ListTodo className="h-4 w-4" /> New task</Link>
          <Link href="/clients" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-ink-800"><Users className="h-4 w-4" /> New client</Link>
        </div>
      )}
    </div>
  );
}

/** Avatar menu — profile, change password, sign out. */
function AvatarMenu({ me }: { me: WhoAmI | undefined }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const name = me?.party?.displayName ?? me?.account?.email ?? "Account";
  const init = name.trim()[0]?.toUpperCase() ?? "?";
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label="Account menu"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-nav-bg text-xs font-bold text-gold-400">
        {init}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-52 overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-lg">
          <div className="border-b border-ink-700 px-3 py-2">
            <div className="truncate text-sm font-semibold text-slate-100">{name}</div>
            {me?.account?.email && <div className="truncate text-xs text-slate-500">{me.account.email}</div>}
          </div>
          <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-ink-800"><Contact className="h-4 w-4" /> Profile & security</Link>
          <Link href="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-200 hover:bg-ink-800"><KeyRound className="h-4 w-4" /> Change password</Link>
          <button type="button" onClick={() => logout()} className="flex w-full items-center gap-2 border-t border-ink-700 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10"><LogOut className="h-4 w-4" /> Sign out</button>
        </div>
      )}
    </div>
  );
}

/** SuperAdmin-only "View as" preview control — read-only, enforced server-side. */
function ViewAsControl({ activeName }: { activeName: string | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);
  const search = async (q: string): Promise<PickItem[]> => {
    const rows = await apiGet<PartyRow[]>(`parties?q=${encodeURIComponent(q)}`);
    return rows.filter((r) => !(r.partyType ?? []).includes("client")).slice(0, 8)
      .map((r) => ({ id: r.id, label: r.displayName, sub: (r.partyType ?? []).join(", ") }));
  };
  return (
    <div ref={ref} className="relative hidden sm:block">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cx("flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs", activeName ? "bg-gold-400/20 text-gold-300" : "text-nav-text hover:bg-nav-hover hover:text-nav-bright")}>
        <Eye className="h-4 w-4" />{activeName ? `Viewing: ${activeName}` : "View as"}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 rounded-xl border border-ink-700 bg-ink-850 p-3 shadow-lg">
          <p className="mb-2 text-xs text-slate-400">Preview the app as another person — read-only.</p>
          <EntityPicker placeholder="Search writers, partners…" search={search} onPick={(i) => { if (i) { setViewAsCookie(i.id); window.location.reload(); } }} />
          {activeName && <button type="button" onClick={() => { clearViewAsCookie(); window.location.reload(); }} className="mt-2 w-full rounded-lg border border-ink-700 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10">Exit preview</button>}
        </div>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  const pathname = usePathname() ?? "/";
  const [drawer, setDrawer] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const perms = me?.permissions;
  const isSuper = !!me?.principal.isSystemSuperadmin;

  // "View as" preview: read the cookie (client-only), fetch the previewed party so
  // the nav re-scopes to THEIR persona; data is RLS-scoped server-side + read-only.
  const [viewAsId, setViewAsId] = useState<string | null>(null);
  useEffect(() => { setViewAsId(readCookie("view-as")); }, []);
  const { data: viewedParty } = useApi<{ displayName: string; partyType: string[] }>(viewAsId ? `parties/${viewAsId}` : null);
  const persona = viewAsId && viewedParty ? personaFromType(viewedParty.partyType) : resolvePersona(me);

  // Restore the collapse preference (client-only; avoids a hydration flash).
  useEffect(() => { setCollapsed(localStorage.getItem("xfas-nav-collapsed") === "1"); }, []);
  const toggleCollapse = () => setCollapsed((c) => { const n = !c; localStorage.setItem("xfas-nav-collapsed", n ? "1" : "0"); return n; });

  const groups = NAV_BY_ROLE[persona]
    .map((g) => ({ ...g, items: g.items.filter((it) => it.perm === null || can(perms, it.perm)) }))
    .filter((g) => g.items.length > 0);

  const activeHref = groups
    .flatMap((g) => g.items)
    .filter((it) => pathname === it.href || pathname.startsWith(it.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
  const isActive = (href: string) => href === activeHref;

  const sidebar = (mini: boolean) => (
    <nav className="space-y-4">
      <Link href="/" className={cx("block", mini ? "px-2" : "px-3")} onClick={() => setDrawer(false)}>
        <Logo onDark compact={mini} />
      </Link>
      {/* Signed-in identity card (View-as switch lands with the read-only preview). */}
      {!mini && me && (
        <div className="mx-2 rounded-lg border border-nav-border bg-nav-hover px-3 py-2">
          <div className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-nav-muted">Signed in as</div>
          <div className="mt-0.5 truncate text-[12.5px] font-semibold text-nav-bright">{me.party?.displayName ?? me.account?.email ?? "You"}</div>
          <div className="truncate text-[10px] text-nav-muted">{PERSONA_LABEL[persona]}</div>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.title}>
          {!mini && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-nav-muted">{g.title}</p>}
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const Icon = it.icon;
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  onClick={() => setDrawer(false)}
                  aria-current={isActive(it.href) ? "page" : undefined}
                  title={it.label}
                  className={cx(
                    "flex items-center gap-2.5 rounded-lg py-1.5 text-sm",
                    mini ? "justify-center px-2" : "px-3",
                    isActive(it.href) ? "bg-gold-400 font-medium text-ink-950" : "text-nav-text hover:bg-nav-hover hover:text-nav-bright",
                  )}
                >
                  <Icon aria-hidden className="h-4 w-4 shrink-0" />
                  {!mini && it.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {!mini && <p className="border-t border-nav-border px-3 pt-3 text-[10px] leading-relaxed text-nav-muted">{FOOTNOTE[persona]}</p>}
    </nav>
  );

  return (
    <div className="min-h-screen bg-ink-900">
      {/* top strip (always dark) */}
      <header className="sticky top-0 z-20 border-b border-nav-border bg-nav-surface">
        <div className="flex h-12 items-center gap-3 px-4">
          <button type="button" className="hidden rounded p-2 text-nav-text hover:bg-nav-hover hover:text-nav-bright lg:inline-flex"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} onClick={toggleCollapse}>
            <PanelLeft aria-hidden className="h-5 w-5" />
          </button>
          <button type="button" className="rounded p-2 text-nav-text hover:bg-nav-hover hover:text-nav-bright lg:hidden"
            aria-label="Open menu" onClick={() => setDrawer(true)}>
            <Menu aria-hidden className="h-5 w-5" />
          </button>
          <Link href="/" className="lg:hidden"><Logo onDark compact /></Link>
          <GlobalSearch />
          <div className="flex-1" />
          {isSuper && <ViewAsControl activeName={viewAsId ? (viewedParty?.displayName ?? "…") : null} />}
          <QuickAdd />
          <ThemeToggle />
          {can(perms, "notifications:view") && <NotificationBell canBroadcast={can(perms, "notifications:approve")} />}
          <AvatarMenu me={me} />
        </div>
      </header>

      {/* View-as preview banner — the app is read-only while active. */}
      {viewAsId && (
        <div className="sticky top-12 z-10 flex flex-wrap items-center justify-center gap-2 bg-gold-400/15 px-4 py-1.5 text-xs text-gold-700 dark:text-gold-300">
          <Eye className="h-3.5 w-3.5" /> Previewing as <strong>{viewedParty?.displayName ?? "…"}</strong> — read-only.
          <button type="button" onClick={() => { clearViewAsCookie(); window.location.reload(); }} className="font-semibold underline">Exit preview</button>
        </div>
      )}

      <div className="flex">
        {/* desktop sidebar (always dark) */}
        <aside className={cx("sticky top-12 hidden h-[calc(100vh-3rem)] shrink-0 overflow-y-auto border-r border-nav-border bg-nav-surface py-4 lg:block", collapsed ? "w-16" : "w-60")}>
          {sidebar(collapsed)}
        </aside>

        {/* mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-30 lg:hidden">
            <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setDrawer(false)} />
            <div className="absolute left-0 top-0 h-full w-64 overflow-y-auto border-r border-nav-border bg-nav-surface py-4 shadow-lg">
              <div className="mb-2 flex justify-end px-3"><button type="button" aria-label="Close" onClick={() => setDrawer(false)} className="rounded p-1 text-nav-text hover:bg-nav-hover"><X className="h-4 w-4" /></button></div>
              {sidebar(false)}
            </div>
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
