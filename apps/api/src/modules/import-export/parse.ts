import ExcelJS from "exceljs";

export type Row = Record<string, string>;

/** RFC4180-ish CSV parse → array of cell arrays (handles quotes, commas, newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = ""; rows.push(row); row = [];
    } else if (c === "\r") {
      // handled by the \n branch (skip lone CR)
    } else {
      field += c;
    }
  }
  // last field/row (if any content)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function toObjects(matrix: string[][]): Row[] {
  const headers = (matrix[0] ?? []).map((h) => h.trim());
  if (headers.length === 0) return [];
  const out: Row[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r] ?? [];
    if (cells.every((c) => (c ?? "").trim() === "")) continue; // skip blank lines
    const obj: Row = {};
    headers.forEach((h, i) => { if (h) obj[h] = (cells[i] ?? "").trim(); });
    out.push(obj);
  }
  return out;
}

/** Parse an uploaded CSV or Excel buffer into header-keyed rows. */
export async function parseUpload(buffer: Buffer, filename: string): Promise<Row[]> {
  const isExcel = /\.(xlsx|xls)$/i.test(filename);
  if (!isExcel) {
    return toObjects(parseCsv(buffer.toString("utf8")));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const matrix: string[][] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    // values is 1-indexed; slice(1) drops the leading empty slot.
    const vals = (row.values as unknown[]).slice(1);
    for (const v of vals) cells.push(v == null ? "" : String(typeof v === "object" && "text" in (v as object) ? (v as { text: string }).text : v).trim());
    matrix.push(cells);
  });
  return toObjects(matrix);
}
