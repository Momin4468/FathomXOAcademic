import { Injectable } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import {
  MODULES,
  PERMISSION_ACTIONS,
  type ModuleKey,
  type PermissionAction,
} from "@business-os/shared";
import {
  REQUIRE_PERMISSION_KEY,
  type RequiredPermission,
} from "../../common/authz/require-permission.decorator.js";

export interface CatalogModule {
  key: ModuleKey;
  label: string;
  /** For each action, whether ANY endpoint actually enforces module:action today. */
  enforced: Record<PermissionAction, boolean>;
}

export interface PermissionCatalog {
  /** The column order for the admin grid. */
  actions: readonly PermissionAction[];
  /** Only modules gated by at least one real @RequirePermission, sorted by label. */
  modules: CatalogModule[];
}

/** Friendly labels for the gated modules (personal_finance is a separate plane). */
const MODULE_LABELS: Partial<Record<ModuleKey, string>> = {
  platform: "Platform & Access",
  reference: "Reference Data",
  work: "Work & Jobs",
  rules: "Deal Terms & Rules",
  capture: "Capture",
  billing: "Billing & Payments",
  expenses: "Expenses",
  outcomes: "Outcomes & Reputation",
  credential_vault: "Credential Vault",
  knowledge: "Knowledge Base",
  checks: "Checks (AI / Plagiarism)",
  referrers: "Referrers",
  custom_fields: "Custom Fields",
  dashboard: "Dashboards",
  ai_capture: "AI Capture",
  import_export: "Import / Export",
  channels: "Channels & Profit-Share",
  client_portal: "Client Portal",
  notifications: "Notifications",
  advances: "Advances & Loans",
  vendor: "Vendor Claims",
  hrm: "HRM / Work Logs",
};

const labelFor = (key: ModuleKey): string =>
  MODULE_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The authoritative permission catalog: which module × action pairs are ACTUALLY
 * enforced by a real `@RequirePermission` decorator anywhere in the app, derived at
 * runtime via Nest's DiscoveryService. This is what makes the admin grid truthful
 * (only enforced cells are toggleable) and self-maintaining — the moment an endpoint
 * adopts `@RequirePermission(x, "delete")`, that cell lights up with no other change.
 * Built once and cached (the controller graph is static after boot).
 */
@Injectable()
export class PermissionCatalogService {
  private cache: PermissionCatalog | null = null;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  /** The set of enforced "module:action" strings (cached). */
  enforcedSet(): Set<string> {
    return this.buildEnforced();
  }

  isEnforced(module: string, action: string): boolean {
    return this.buildEnforced().has(`${module}:${action}`);
  }

  build(): PermissionCatalog {
    if (this.cache) return this.cache;
    const enforced = this.buildEnforced();
    const modules: CatalogModule[] = [];
    for (const key of MODULES) {
      const flags = Object.fromEntries(
        PERMISSION_ACTIONS.map((a) => [a, enforced.has(`${key}:${a}`)]),
      ) as Record<PermissionAction, boolean>;
      // Only surface modules that are gated by at least one real endpoint today
      // (this naturally excludes personal_finance, which has its own auth plane).
      if (PERMISSION_ACTIONS.some((a) => flags[a])) {
        modules.push({ key, label: labelFor(key), enforced: flags });
      }
    }
    modules.sort((a, b) => a.label.localeCompare(b.label));
    this.cache = { actions: PERMISSION_ACTIONS, modules };
    return this.cache;
  }

  private enforcedCache: Set<string> | null = null;

  private buildEnforced(): Set<string> {
    if (this.enforcedCache) return this.enforcedCache;
    const enforced = new Set<string>();
    const add = (meta: RequiredPermission | undefined) => {
      if (meta) enforced.add(`${meta.module}:${meta.action}`);
    };
    for (const wrapper of this.discovery.getControllers()) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance) continue;
      // Class-level @RequirePermission (rare, but supported by the guard).
      add(this.reflector.get<RequiredPermission>(REQUIRE_PERMISSION_KEY, instance.constructor));
      const proto = Object.getPrototypeOf(instance);
      for (const name of this.scanner.getAllMethodNames(proto)) {
        add(this.reflector.get<RequiredPermission>(REQUIRE_PERMISSION_KEY, proto[name]));
      }
    }
    this.enforcedCache = enforced;
    return enforced;
  }
}
