"use client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { formatDate } from "@/lib/format";
import { Button, EmptyState, Money, StateBadge, cx } from "./ui";
import { useToast } from "./toast";

/**
 * Shared data-table (UI_AUDIT R2). Sticky header, click-to-sort, global search,
 * per-column filters, row-checkbox bulk actions, pagination + total count, money
 * column totals (over the filtered set), density toggle, and CSV/Excel/PDF export.
 * One primitive; every list page adopts it. Numbers right-aligned, badges centered
 * (rubric §Data Tables). Filter/search/sort/density persist per `tableId`.
 */
export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  sortable?: boolean;
  filter?: "text" | "select";
  filterOptions?: string[];
  format?: "money" | "date" | "badge" | "text";
  currency?: string; // for money format
  total?: boolean; // sum this (money) column in the footer
  /** Custom cell renderer (links, badges, actions). */
  render?: (row: T) => ReactNode;
  /** Underlying value for sort/filter/search/export/total when render is custom. */
  value?: (row: T) => string | number | null | undefined;
}

type SortState = { key: string; dir: "asc" | "desc" } | null;

function colValue<T>(col: Column<T>, row: T): string | number | null | undefined {
  if (col.value) return col.value(row);
  return (row as Record<string, unknown>)[col.key] as string | number | null | undefined;
}

function formatCell<T>(col: Column<T>, row: T): ReactNode {
  if (col.render) return col.render(row);
  const v = colValue(col, row);
  if (col.format === "money") return <Money value={v as never} prefix={col.currency ?? "৳"} signed />;
  if (col.format === "date") return v ? formatDate(String(v)) : "";
  if (col.format === "badge") return v ? <StateBadge state={String(v)} /> : "";
  return v === null || v === undefined ? "" : String(v);
}

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  tableId,
  searchable = true,
  bulkActions,
  onRowClick,
  pageSize = 25,
  exportName = "export",
  emptyTitle = "Nothing here yet",
  emptyHint,
}: {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  tableId: string;
  searchable?: boolean;
  bulkActions?: (selectedIds: string[], clear: () => void) => ReactNode;
  onRowClick?: (row: T) => void;
  pageSize?: number;
  exportName?: string;
  emptyTitle?: string;
  emptyHint?: string;
}) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<SortState>(null);
  const [dense, setDense] = useState(false);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Persist view state per table (rubric golden rule: "make filters persist").
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`dt:${tableId}`);
      if (raw) {
        const s = JSON.parse(raw);
        setSearch(s.search ?? "");
        setFilters(s.filters ?? {});
        setSort(s.sort ?? null);
        setDense(!!s.dense);
      }
    } catch {
      /* ignore */
    }
  }, [tableId]);
  useEffect(() => {
    try {
      localStorage.setItem(`dt:${tableId}`, JSON.stringify({ search, filters, sort, dense }));
    } catch {
      /* ignore */
    }
  }, [tableId, search, filters, sort, dense]);

  const filtered = useMemo(() => {
    let out = rows;
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((r) =>
        columns.some((c) => String(colValue(c, r) ?? "").toLowerCase().includes(q)),
      );
    }
    for (const [key, val] of Object.entries(filters)) {
      if (!val) continue;
      const col = columns.find((c) => c.key === key);
      if (!col) continue;
      const needle = val.toLowerCase();
      out = out.filter((r) => {
        const cell = String(colValue(col, r) ?? "").toLowerCase();
        return col.filter === "select" ? cell === needle : cell.includes(needle);
      });
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = colValue(col, a);
          const bv = colValue(col, b);
          let cmp: number;
          if (col.format === "date") {
            cmp = (Date.parse(String(av)) || 0) - (Date.parse(String(bv)) || 0);
          } else {
            const na = Number(av);
            const nb = Number(bv);
            if (!Number.isNaN(na) && !Number.isNaN(nb) && av !== "" && bv !== "") cmp = na - nb;
            else cmp = String(av ?? "").localeCompare(String(bv ?? ""));
          }
          return sort.dir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
  }, [rows, columns, search, filters, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of columns) {
      if (!c.total) continue;
      t[c.key] = filtered.reduce((s, r) => s + (Number(colValue(c, r)) || 0), 0);
    }
    return t;
  }, [columns, filtered]);

  const toggleSort = (key: string) =>
    setSort((s) => (s?.key === key ? (s.dir === "asc" ? { key, dir: "desc" } : null) : { key, dir: "asc" }));

  const clearSelection = () => setSelected(new Set());
  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(getRowId(r)));
  const toggleAllOnPage = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((r) => next.delete(getRowId(r)));
      else pageRows.forEach((r) => next.add(getRowId(r)));
      return next;
    });

  // ─── export (filtered rows; raw values) ─────────────────────────────────────
  const exportRows = () => filtered.map((r) => columns.map((c) => colValue(c, r) ?? ""));
  const headers = columns.map((c) => c.header);

  function exportCsv() {
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [headers.map(esc).join(","), ...exportRows().map((row) => row.map(esc).join(","))];
    download(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }), `${exportName}.csv`);
    toast({ title: "Exported CSV", variant: "success" });
  }
  async function exportExcel() {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([headers, ...exportRows()]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    XLSX.writeFile(wb, `${exportName}.xlsx`);
    toast({ title: "Exported Excel", variant: "success" });
  }
  async function exportPdf() {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF();
    autoTable(doc, { head: [headers], body: exportRows().map((r) => r.map(String)) });
    doc.save(`${exportName}.pdf`);
    toast({ title: "Exported PDF", variant: "success" });
  }
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const selectedIds = [...selected];
  const cellPad = dense ? "px-2 py-1" : "px-3 py-2";
  const alignCls = (a?: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  const hasFilters = columns.some((c) => c.filter);

  return (
    <div>
      {/* toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {searchable && (
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search…"
            className="min-h-[40px] w-full max-w-xs rounded-lg border border-gray-300 px-3 text-sm outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 sm:w-56"
          />
        )}
        <span className="text-xs text-gray-500">{filtered.length} {filtered.length === 1 ? "row" : "rows"}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => setDense((d) => !d)} className="rounded px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100" title="Density">
            {dense ? "Comfortable" : "Compact"}
          </button>
          <button type="button" onClick={exportCsv} className="rounded px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100">CSV</button>
          <button type="button" onClick={exportExcel} className="rounded px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100">Excel</button>
          <button type="button" onClick={exportPdf} className="rounded px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100">PDF</button>
        </div>
      </div>

      {/* bulk-action bar */}
      {bulkActions && selectedIds.length > 0 && (
        <div className="mb-2 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          <span className="font-medium">{selectedIds.length} selected</span>
          {bulkActions(selectedIds, clearSelection)}
          <button type="button" onClick={clearSelection} className="ml-auto rounded px-2.5 py-1.5 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900">Clear</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-xl border border-gray-200">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-gray-50">
              <tr>
                {bulkActions && (
                  <th className={cx("w-8", cellPad)}>
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} aria-label="Select all on page" />
                  </th>
                )}
                {columns.map((c) => (
                  <th
                    key={c.key}
                    className={cx("border-b border-gray-200 font-medium text-gray-600", cellPad, alignCls(c.align), c.sortable && "cursor-pointer select-none hover:text-gray-900")}
                    onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                    onKeyDown={c.sortable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleSort(c.key); } } : undefined}
                    tabIndex={c.sortable ? 0 : undefined}
                    role={c.sortable ? "button" : undefined}
                    aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined}
                  >
                    {c.header}
                    {sort?.key === c.key && <span className="ml-1 text-gray-400">{sort.dir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                ))}
              </tr>
              {hasFilters && (
                <tr>
                  {bulkActions && <th className={cellPad} />}
                  {columns.map((c) => (
                    <th key={c.key} className={cx("border-b border-gray-100", cellPad)}>
                      {c.filter === "text" && (
                        <input
                          value={filters[c.key] ?? ""}
                          onChange={(e) => {
                            setFilters((f) => ({ ...f, [c.key]: e.target.value }));
                            setPage(0);
                          }}
                          placeholder="filter"
                          className="min-h-[34px] w-full rounded border border-gray-200 px-2 text-xs outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                        />
                      )}
                      {c.filter === "select" && (
                        <select
                          value={filters[c.key] ?? ""}
                          onChange={(e) => {
                            setFilters((f) => ({ ...f, [c.key]: e.target.value }));
                            setPage(0);
                          }}
                          className="min-h-[34px] w-full rounded border border-gray-200 bg-white px-1 text-xs outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900"
                        >
                          <option value="">all</option>
                          {(c.filterOptions ?? []).map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      )}
                    </th>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const id = getRowId(r);
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(r) : undefined}
                    className={cx("border-b border-gray-100 last:border-0 hover:bg-gray-50", onRowClick && "cursor-pointer")}
                  >
                    {bulkActions && (
                      <td className={cellPad} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selected.has(id)}
                          onChange={() =>
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            })
                          }
                          aria-label="Select row"
                        />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cx(cellPad, alignCls(c.align), c.format === "money" && "tabular-nums")}>
                        {formatCell(c, r)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            {Object.keys(totals).length > 0 && (
              <tfoot className="bg-gray-50 font-medium">
                <tr>
                  {bulkActions && <td className={cellPad} />}
                  {columns.map((c, i) => (
                    <td key={c.key} className={cx(cellPad, alignCls(c.align), c.total && "tabular-nums")}>
                      {c.total ? <Money value={totals[c.key]} prefix={c.currency ?? "৳"} /> : i === 0 && !bulkActions ? "Total" : ""}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* pagination */}
      {pageCount > 1 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-xs text-gray-500">
          <button type="button" disabled={safePage === 0} onClick={() => setPage(safePage - 1)} className="rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-40">Prev</button>
          <span>Page {safePage + 1} of {pageCount}</span>
          <button type="button" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)} className="rounded px-3 py-1.5 hover:bg-gray-100 disabled:opacity-40">Next</button>
        </div>
      )}
    </div>
  );
}
