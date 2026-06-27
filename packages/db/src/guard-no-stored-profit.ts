import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { migrationsDir } from "./run-migrations.js";

/**
 * Guard the non-negotiable "profit is derived, never stored" rule (SCHEMA §I,
 * CLAUDE.md §3.3). Fails if any migration introduces a forbidden stored column.
 * Comments are stripped first so the rule's own documentation doesn't trip it.
 */
const FORBIDDEN = [/\bprofit\b/i, /\bmargin\b/i, /\bsplit_amount\b/i];

function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " "); // line comments
}

async function main() {
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql"));
  const violations: string[] = [];
  for (const file of files) {
    const code = stripSqlComments(await readFile(join(migrationsDir, file), "utf8"));
    for (const rx of FORBIDDEN) {
      const m = code.match(rx);
      if (m) violations.push(`${file}: contains forbidden token "${m[0]}"`);
    }
  }
  if (violations.length > 0) {
    console.error("✗ no-stored-profit guard FAILED:");
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log("✓ no-stored-profit guard passed (no profit/margin/split_amount columns).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
