// spec: docs/specs/content-deploy.md §Behaviour.1, 2; §Open questions (D1 load mechanism)
// Pure builder for the content-deploy SQL applied to D1 via `wrangler d1 execute --file`. Content is
// PUSH-ONLY from the local SQLite DB (never edited online), so every row is emitted as
// `INSERT OR REPLACE` keyed on its primary-key id: re-running deploy:content overwrites in place and is
// idempotent (Behaviour.2). Tables MUST be supplied parent-first (FK order) so a row's references exist
// when it is inserted. No `node:*` imports — unit-tested in isolation, then invoked by
// scripts/deploy-content.ts which reads the rows from the local libSQL client.

export type DeployTable = {
  table: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

// Rows per INSERT statement — keeps any single statement well within D1's parser/statement limits.
const CHUNK = 50;

// Render one value as a SQLite literal. Raw libSQL reads already yield primitives (integers for
// boolean/timestamp columns), so there is no Date/boolean coercion to undo here.
export function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (value instanceof Uint8Array) {
    let hex = "";
    for (const b of value) hex += b.toString(16).padStart(2, "0");
    return `X'${hex}'`;
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- deliberate best-effort string fallback for any residual scalar the SQLite driver may hand back; the result is then single-quote-escaped as a SQL literal.
  const s = typeof value === "string" ? value : String(value);
  // SQLite string literal: wrap in single quotes, double any embedded single quote.
  return `'${s.replace(/'/g, "''")}'`;
}

// Build the full `INSERT OR REPLACE` script for the supplied tables (empty tables are skipped).
export function buildDeploySql(tables: DeployTable[]): string {
  const statements: string[] = [];
  for (const { table, columns, rows } of tables) {
    if (rows.length === 0) continue;
    const colList = columns.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values = chunk
        .map((row) => `(${columns.map((c) => sqlLiteral(row[c])).join(", ")})`)
        .join(",\n  ");
      statements.push(
        `INSERT OR REPLACE INTO "${table}" (${colList}) VALUES\n  ${values};`,
      );
    }
  }
  return statements.join("\n");
}
