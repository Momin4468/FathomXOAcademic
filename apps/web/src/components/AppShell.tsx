"use client";
import Link from "next/link";
import { useApi, logout } from "@/lib/api";
import type { WhoAmI } from "@/lib/types";
import { Button } from "./ui";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: me } = useApi<WhoAmI>("platform/whoami");
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Business OS
          </Link>
          <div className="flex items-center gap-3">
            {me?.party?.displayName && (
              <span className="hidden text-xs text-gray-500 sm:inline">{me.party.displayName}</span>
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
