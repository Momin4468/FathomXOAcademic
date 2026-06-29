"""Shared helpers for the example preprocessing scripts.

Read a source sheet (CSV, or Excel with `pip install openpyxl`), remap its columns
to a target template, and write the template CSV. No app/DB access — pure file I/O.
"""
import csv
import sys


def read_rows(path):
    """Read a CSV or .xlsx into a list of dicts keyed by the header row."""
    if path.lower().endswith((".xlsx", ".xlsm")):
        try:
            import openpyxl  # noqa: WPS433
        except ImportError:
            sys.exit("This is an Excel file — run `pip install openpyxl` first, or save it as CSV.")
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            return []
        headers = [str(h).strip() if h is not None else "" for h in rows[0]]
        out = []
        for r in rows[1:]:
            if all(c is None or str(c).strip() == "" for c in r):
                continue
            out.append({headers[i]: ("" if c is None else str(c).strip()) for i, c in enumerate(r) if i < len(headers)})
        return out
    with open(path, newline="", encoding="utf-8-sig") as f:
        return [{k: (v or "").strip() for k, v in row.items()} for row in csv.DictReader(f)]


def remap(row, mapping, constants=None):
    """Build a target row: {target_header: source_value} per `mapping`
    (target -> source column name), plus fixed `constants` (target -> value)."""
    out = {}
    for target, source in mapping.items():
        out[target] = row.get(source, "") if source else ""
    for target, value in (constants or {}).items():
        if not out.get(target):
            out[target] = value
    return out


def write_template(path, headers, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({h: r.get(h, "") for h in headers})
    print(f"Wrote {len(rows)} rows -> {path}")


def run(headers, mapping, constants=None):
    """CLI entry: python convert_X.py <input> <output.csv>."""
    if len(sys.argv) < 3:
        sys.exit(f"usage: python {sys.argv[0]} <input.csv|.xlsx> <output.csv>")
    rows = [remap(r, mapping, constants) for r in read_rows(sys.argv[1])]
    write_template(sys.argv[2], headers, rows)
