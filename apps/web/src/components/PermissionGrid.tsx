"use client";
import { useRef, useEffect } from "react";
import type { PermAction, PermissionCatalog } from "@/lib/types";
import { cx } from "./ui";

const key = (module: string, action: string) => `${module}:${action}`;
const ACTION_LABELS: Record<PermAction, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  approve: "Approve",
  delete: "Delete",
  export: "Export",
};

/**
 * The module × action permission matrix. Reflects the server's catalog: only
 * pairs an endpoint actually enforces are interactive; the rest (all delete/export
 * today, plus gaps) render disabled with a tooltip. Toggling a cell calls
 * `onToggle`; the parent persists + revalidates. Column headers select-all within
 * a column (enforced cells only). `locked` renders the whole grid read-only
 * (System SuperAdmin); `canEdit` gates on the caller's platform:approve.
 */
export function PermissionGrid({
  catalog,
  granted,
  canEdit,
  locked = false,
  onToggle,
}: {
  catalog: PermissionCatalog;
  granted: Set<string>;
  canEdit: boolean;
  locked?: boolean;
  onToggle: (module: string, action: PermAction, next: boolean) => void;
}) {
  const editable = canEdit && !locked;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="sticky left-0 z-10 bg-white px-3 py-2 font-semibold text-gray-700">Module</th>
            {catalog.actions.map((action) => {
              const cells = catalog.modules.filter((m) => m.enforced[action]);
              const on = cells.filter((m) => granted.has(key(m.key, action))).length;
              const allOn = cells.length > 0 && on === cells.length;
              const someOn = on > 0 && !allOn;
              return (
                <th key={action} className="px-2 py-2 text-center font-medium text-gray-600">
                  <div className="flex flex-col items-center gap-1">
                    <span>{ACTION_LABELS[action]}</span>
                    <ColumnToggle
                      checked={allOn}
                      indeterminate={someOn}
                      disabled={!editable || cells.length === 0}
                      title={cells.length === 0 ? "No module enforces this action yet" : `Toggle ${ACTION_LABELS[action]} for all`}
                      onChange={() => {
                        const next = !allOn;
                        for (const m of cells) {
                          if (granted.has(key(m.key, action)) !== next) onToggle(m.key, action, next);
                        }
                      }}
                    />
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {catalog.modules.map((m) => (
            <tr key={m.key} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-gray-800">{m.label}</td>
              {catalog.actions.map((action) => {
                const enforced = m.enforced[action];
                const isOn = granted.has(key(m.key, action));
                return (
                  <td key={action} className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      className={cx("h-4 w-4 align-middle", !enforced && "opacity-30")}
                      aria-label={`${m.label} — ${ACTION_LABELS[action]}`}
                      checked={isOn}
                      disabled={!editable || !enforced}
                      title={
                        !enforced
                          ? "No endpoint enforces this permission yet"
                          : !editable
                            ? undefined
                            : `${ACTION_LABELS[action]} ${m.label}`
                      }
                      onChange={(e) => onToggle(m.key, action, e.target.checked)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A checkbox that can render the tri-state "indeterminate" (some-but-not-all). */
function ColumnToggle({
  checked,
  indeterminate,
  disabled,
  title,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  title: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="h-3.5 w-3.5"
      checked={checked}
      disabled={disabled}
      title={title}
      aria-label={title}
      onChange={onChange}
    />
  );
}
