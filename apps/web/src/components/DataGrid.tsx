"use client";
import { useMemo, useState, type ReactNode } from "react";
import { RotateCcw, type LucideIcon } from "lucide-react";
import { Badge, Button, Card, Chip, EmptyState, Money, MoneyInput, Spinner, StateBadge, cx } from "./ui";

/**
 * The config-driven DataGrid — the backbone of the handoff's ~15 CRUD screens
 * (mirrors the prototype's `C[table]` configs). One component renders columns of
 * mixed `kind` (text/money/mono/badge/select/derived), optional inline editing
 * (enum columns use a select; money uses MoneyInput), KPI stat cards, per-row
 * action icons, a bulk-select bar, and an add-row slot. `adminOnly` columns drop
 * for non-admins (the server stays the real gate). Append-only tables show a
 * Reverse action instead of edit/delete — corrections are reversing entries, never
 * edits (money rule). Money cells use <Money>, which renders nothing when the value
 * is absent (redaction-safe), so a column the viewer may not see just shows blank.
 */
export type CellKind = "text" | "number" | "money" | "mono" | "badge" | "select" | "derived";

export interface DataGridColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  kind?: CellKind;
  /** Inline-editable (text/number/money/select). Ignored on append-only grids. */
  editable?: boolean;
  /** Hidden entirely unless `isAdmin`. */
  adminOnly?: boolean;
  /** Warm "parchment" treatment — the owner's private columns. */
  tone?: "private";
  /** Options for kind="select". */
  options?: string[];
  /** Accessor; defaults to row[key]. */
  value?: (row: T) => string | number | null | undefined;
  /** Full cell override (wins over kind). */
  render?: (row: T) => ReactNode;
  /** Secondary muted line under the cell. */
  sub?: (row: T) => ReactNode;
  width?: string;
}

export interface DataGridStat {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "green" | "red" | "gold" | "private";
}

export interface DataGridAction<T> {
  icon: LucideIcon;
  label: string;
  tone?: "default" | "blue" | "purple" | "danger";
  onClick: (row: T) => void;
}

export interface DataGridProps<T> {
  title?: string;
  sub?: string;
  foot?: string;
  columns: DataGridColumn<T>[];
  rows: T[] | undefined;
  getRowId: (row: T) => string;
  isAdmin?: boolean;
  stats?: DataGridStat[];
  /** Persist an inline edit. Called with the row, column key, and new raw value. */
  onCellEdit?: (row: T, key: string, value: string) => void | Promise<void>;
  rowActions?: (row: T) => DataGridAction<T>[];
  bulkActions?: (ids: string[], clear: () => void) => { label: string; tone?: "default" | "danger"; onClick: () => void }[];
  /** Append-only ledger: no inline edit; offer Reverse instead. */
  appendOnly?: boolean;
  onReverse?: (row: T) => void;
  /** Add-row: a button that toggles the caller-supplied form body. */
  addButton?: string;
  addForm?: ReactNode;
  emptyTitle?: string;
  loading?: boolean;
}

const STAT_TONE: Record<NonNullable<DataGridStat["tone"]>, string> = {
  neutral: "bg-ink-850 border-ink-700 text-slate-100",
  green: "bg-ink-850 border-ink-700 text-emerald-600 dark:text-emerald-400",
  red: "bg-ink-850 border-ink-700 text-red-600 dark:text-red-400",
  gold: "bg-nav-surface border-nav-border text-gold-400",
  private: "bg-parchment border-parchment-border text-parchment-text",
};

const ACTION_TONE: Record<NonNullable<DataGridAction<unknown>["tone"]>, string> = {
  default: "text-slate-400 hover:bg-ink-800",
  blue: "text-blue-500 hover:bg-blue-500/10",
  purple: "text-plum-500 hover:bg-plum-500/10",
  danger: "text-red-500 hover:bg-red-500/10",
};

const alignCls = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");

function raw<T>(col: DataGridColumn<T>, row: T): string | number | null | undefined {
  if (col.value) return col.value(row);
  return (row as Record<string, unknown>)[col.key] as string | number | null | undefined;
}

/** One inline-editable cell (text / number / money). Click to edit, Enter/blur saves, Esc cancels. */
function EditCell<T>({ col, row, onSave }: { col: DataGridColumn<T>; row: T; onSave: (v: string) => void }) {
  const initial = raw(col, row);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(initial == null ? "" : String(initial));
  if (!editing) {
    return (
      <button type="button" onClick={() => { setVal(initial == null ? "" : String(initial)); setEditing(true); }}
        className="w-full rounded px-1 py-0.5 text-left hover:bg-ink-800/60">
        {col.kind === "money" ? <Money value={initial as number} /> : (initial == null || initial === "" ? <span className="text-slate-500">—</span> : String(initial))}
      </button>
    );
  }
  const commit = () => { setEditing(false); if (String(initial ?? "") !== val) onSave(val); };
  if (col.kind === "money") {
    return <div className="w-24"><MoneyInput value={val} onChange={setVal} /></div>;
  }
  return (
    <input
      autoFocus
      type={col.kind === "number" ? "number" : "text"}
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      className="w-full rounded border border-gold-400 bg-ink-850 px-1.5 py-0.5 text-sm outline-none"
    />
  );
}

export function DataGrid<T>(props: DataGridProps<T>) {
  const { columns, rows, getRowId, isAdmin = false, onCellEdit, rowActions, bulkActions, appendOnly, onReverse } = props;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addOpen, setAddOpen] = useState(false);

  const cols = useMemo(() => columns.filter((c) => !c.adminOnly || isAdmin), [columns, isAdmin]);
  const hasActions = !!rowActions || appendOnly;
  const clearSel = () => setSelected(new Set());
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const bulk = bulkActions && selected.size > 0 ? bulkActions([...selected], clearSel) : [];

  function cell(col: DataGridColumn<T>, row: T): ReactNode {
    if (col.render) return col.render(row);
    const v = raw(col, row);
    const editable = col.editable && !appendOnly && onCellEdit;
    if (col.kind === "select") {
      if (editable) {
        return (
          <select value={v == null ? "" : String(v)} onChange={(e) => onCellEdit!(row, col.key, e.target.value)}
            className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1 text-xs">
            {(col.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      return <StateBadge state={String(v ?? "")} />;
    }
    if (editable && (col.kind === "text" || col.kind === "number" || col.kind === "money")) {
      return <EditCell col={col} row={row} onSave={(nv) => onCellEdit!(row, col.key, nv)} />;
    }
    if (col.kind === "money") return <Money value={v as number} />;
    if (col.kind === "mono") return v == null ? null : <Chip>{String(v)}</Chip>;
    if (col.kind === "badge") return v == null ? null : <Badge tone="gray">{String(v)}</Badge>;
    return v == null || v === "" ? <span className="text-slate-500">—</span> : String(v);
  }

  return (
    <div className="space-y-4">
      {(props.title || props.addButton) && (
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            {props.title && <h1 className="font-display text-2xl font-semibold tracking-tight">{props.title}</h1>}
            {props.sub && <p className="mt-0.5 text-xs text-slate-400">{props.sub}</p>}
          </div>
          {props.addButton && isAdmin && (
            <Button variant="secondary" onClick={() => setAddOpen((o) => !o)}>{addOpen ? "Close" : props.addButton}</Button>
          )}
        </div>
      )}

      {addOpen && props.addForm && <Card>{props.addForm}</Card>}

      {props.stats && props.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {props.stats.map((s, i) => (
            <div key={i} className={cx("rounded-xl border px-4 py-3", STAT_TONE[s.tone ?? "neutral"])}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{s.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {bulk.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-nav-surface px-4 py-2">
          <span className="text-sm font-semibold text-nav-bright">{selected.size} selected</span>
          <div className="flex-1" />
          {bulk.map((b, i) => (
            <Button key={i} variant={b.tone === "danger" ? "danger" : "secondary"} className="min-h-0 px-3 py-1 text-xs" onClick={b.onClick}>{b.label}</Button>
          ))}
          <button type="button" onClick={clearSel} className="px-2 text-xs text-nav-muted hover:text-nav-bright">Clear</button>
        </div>
      )}

      <Card className="overflow-x-auto p-0">
        {props.loading ? (
          <div className="p-6"><Spinner /></div>
        ) : !rows || rows.length === 0 ? (
          <div className="p-6"><EmptyState title={props.emptyTitle ?? "Nothing here yet"} /></div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-ink-700">
                {bulkActions && <th className="w-9 px-3 py-2" />}
                {cols.map((c) => (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined}
                    className={cx("px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500", alignCls(c.align), c.tone === "private" && "bg-parchment text-parchment-text")}>
                    {c.label}
                  </th>
                ))}
                {hasActions && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = getRowId(row);
                const acts = rowActions ? rowActions(row) : [];
                return (
                  <tr key={id} className="border-b border-ink-800 last:border-0 hover:bg-ink-800/60">
                    {bulkActions && (
                      <td className="px-3 py-2"><input type="checkbox" checked={selected.has(id)} onChange={() => toggle(id)} aria-label="Select row" /></td>
                    )}
                    {cols.map((c) => (
                      <td key={c.key} className={cx("px-3 py-2 align-top", alignCls(c.align), (c.kind === "money" || c.kind === "number") && "tabular-nums", c.tone === "private" && "bg-parchment/60 dark:bg-parchment-text/10")}>
                        {cell(c, row)}
                        {c.sub && <div className="mt-0.5 text-[11px] text-slate-500">{c.sub(row)}</div>}
                      </td>
                    ))}
                    {hasActions && (
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {appendOnly && onReverse && (
                          <button type="button" title="Reverse" onClick={() => onReverse(row)} className="inline-flex rounded p-1 text-red-500 hover:bg-red-500/10"><RotateCcw className="h-3.5 w-3.5" /></button>
                        )}
                        {acts.map((a, i) => {
                          const Icon = a.icon;
                          return (
                            <button key={i} type="button" title={a.label} onClick={() => a.onClick(row)} className={cx("inline-flex rounded p-1", ACTION_TONE[a.tone ?? "default"])}>
                              <Icon className="h-3.5 w-3.5" />
                            </button>
                          );
                        })}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {props.foot && <p className="text-xs text-slate-500">{props.foot}</p>}
    </div>
  );
}
