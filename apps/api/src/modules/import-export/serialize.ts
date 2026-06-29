import ExcelJS from "exceljs";

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Column order = the provided headers, else the union of keys across rows (stable). */
function resolveHeaders(rows: Array<Record<string, unknown>>, headers?: string[]): string[] {
  if (headers) return headers;
  const seen: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k);
  return seen;
}

export function toCsv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  const cols = resolveHeaders(rows, headers);
  const lines = [cols.map(cell).join(",")];
  for (const r of rows) lines.push(cols.map((c) => cell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export async function toXlsx(rows: Array<Record<string, unknown>>, headers?: string[], sheet = "Export"): Promise<Buffer> {
  const cols = resolveHeaders(rows, headers);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.addRow(cols);
  for (const r of rows) ws.addRow(cols.map((c) => {
    const v = r[c];
    return v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : (v as string | number);
  }));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
