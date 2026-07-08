"use client";
import Link from "next/link";
import { useApi, logout } from "@/lib/api";
import { can, type WhoAmI } from "@/lib/types";
import { Button } from "./ui";
import { NotificationBell } from "./NotificationBell";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              Business OS
            </Link>
            {can(me?.permissions, "ai_capture:create") && (
              <Link href="/capture" className="text-gray-600 hover:text-gray-900">
                AI capture
              </Link>
            )}
            {can(me?.permissions, "capture:view") && (
              <Link href="/tasks" className="text-gray-600 hover:text-gray-900">
                Tasks
              </Link>
            )}
            {can(me?.permissions, "billing:view") && (
              <Link href="/invoices" className="text-gray-600 hover:text-gray-900">
                Invoices
              </Link>
            )}
            {can(me?.permissions, "billing:view") && (
              <Link href="/payments" className="text-gray-600 hover:text-gray-900">
                Payments
              </Link>
            )}
            {can(me?.permissions, "billing:view") && (
              <Link href="/settlement" className="text-gray-600 hover:text-gray-900">
                Settlement
              </Link>
            )}
            {can(me?.permissions, "reference:view") && (
              <Link href="/clients" className="text-gray-600 hover:text-gray-900">
                Clients
              </Link>
            )}
            {can(me?.permissions, "credential_vault:view") && (
              <Link href="/vault" className="text-gray-600 hover:text-gray-900">
                Vault
              </Link>
            )}
            {can(me?.permissions, "outcomes:view") && (
              <Link href="/outcomes" className="text-gray-600 hover:text-gray-900">
                Outcomes
              </Link>
            )}
            {can(me?.permissions, "expenses:view") && (
              <Link href="/expenses" className="text-gray-600 hover:text-gray-900">
                Expenses
              </Link>
            )}
            {can(me?.permissions, "advances:view") && (
              <Link href="/advances" className="text-gray-600 hover:text-gray-900">
                Advances
              </Link>
            )}
            {can(me?.permissions, "dashboard:view") && (
              <Link href="/analytics" className="text-gray-600 hover:text-gray-900">
                Analytics
              </Link>
            )}
            {can(me?.permissions, "import_export:view") && (
              <Link href="/data" className="text-gray-600 hover:text-gray-900">
                Data
              </Link>
            )}
            {/* Balance is universal — any party can see their own two-way position. */}
            <Link href="/balance" className="text-gray-600 hover:text-gray-900">
              Balance
            </Link>
            {can(me?.permissions, "knowledge:view") && (
              <Link href="/knowledge" className="text-gray-600 hover:text-gray-900">
                Knowledge
              </Link>
            )}
            {can(me?.permissions, "knowledge:view") && (
              <Link href="/cover-sheets" className="text-gray-600 hover:text-gray-900">
                Cover sheets
              </Link>
            )}
            {can(me?.permissions, "checks:view") && (
              <Link href="/checks" className="text-gray-600 hover:text-gray-900">
                Checks
              </Link>
            )}
            {can(me?.permissions, "referrers:approve") && (
              <Link href="/referrers" className="text-gray-600 hover:text-gray-900">
                Referrers
              </Link>
            )}
            {can(me?.permissions, "channels:approve") && (
              <Link href="/channels" className="text-gray-600 hover:text-gray-900">
                Channels
              </Link>
            )}
            {can(me?.permissions, "client_portal:view") && (
              <Link href="/client-admin" className="text-gray-600 hover:text-gray-900">
                Client portal
              </Link>
            )}
            {can(me?.permissions, "channels:view") && (
              <Link href="/channels/mine" className="text-gray-600 hover:text-gray-900">
                My share
              </Link>
            )}
            {can(me?.permissions, "referrers:view") && (
              <Link href="/referrers/me" className="text-gray-600 hover:text-gray-900">
                My referrals
              </Link>
            )}
            {can(me?.permissions, "work:approve") && (
              <Link href="/resit" className="text-gray-600 hover:text-gray-900">
                Resit
              </Link>
            )}
            {can(me?.permissions, "custom_fields:view") && (
              <Link href="/custom-fields" className="text-gray-600 hover:text-gray-900">
                Custom fields
              </Link>
            )}
          </nav>
          <div className="flex items-center gap-3">
            {me?.party?.displayName && (
              <span className="hidden text-xs text-gray-500 sm:inline">{me.party.displayName}</span>
            )}
            {can(me?.permissions, "notifications:view") && (
              <NotificationBell canBroadcast={can(me?.permissions, "notifications:approve")} />
            )}
            <Button variant="ghost" className="px-2 text-xs" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-5">{children}</main>
    </div>
  );
}
