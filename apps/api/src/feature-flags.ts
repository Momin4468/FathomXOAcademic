import type { ModuleKey } from "@business-os/shared";

/**
 * Feature flags so "sell module-by-module" stays configuration (CLAUDE.md §2/§5).
 * `platform` (module 0) is always on — it's the spine. Others are opt-in via
 * env FEATURE_<MODULE>=true and will be wired as they're built.
 */
export function isModuleEnabled(key: ModuleKey): boolean {
  if (key === "platform") return true;
  return (process.env[`FEATURE_${key.toUpperCase()}`] ?? "false").toLowerCase() === "true";
}
