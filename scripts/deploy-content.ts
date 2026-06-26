import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { client } from "../server/db";
import { resolveMediaPath } from "../server/config/env";
import { buildDeploySql, type DeployTable } from "../server/lib/deploy-sql";

// spec: docs/specs/content-deploy.md §Behaviour.1, 2; §Scope (content-deploy script)
// Push locally-imported content to the deployed Cloudflare instance: D1 (data) + R2 (media). Content
// originates locally (OCR/Whisper/Claude are local-only), so the flow is import-locally → deploy.
//
//   npm run deploy:content                # push to the remote D1 + R2 (needs `wrangler login`)
//   npm run deploy:content -- --dry-run   # print the SQL + planned uploads, change nothing
//   npm run deploy:content -- --local     # target the local `wrangler dev` D1/R2 instead of remote
//
// D1 load: ALL content tables are dumped as idempotent `INSERT OR REPLACE` SQL (server/lib/deploy-sql)
// and applied via `wrangler d1 execute --file`. This uniformly covers reading/listening questions AND
// writing/speaking tasks (the export/import service covers questions only). Re-running overwrites in
// place (Behaviour.2). Media: each referenced object is uploaded to R2 under its stored relative key,
// which is exactly the key the R2 MediaStore reads at serve time.

// Parent-first (FK order): a row's references must already exist when it is inserted.
const CONTENT_TABLES = [
  "passages",
  "questions",
  "options",
  "audio_files",
  "transcript_segments",
  "writing_tasks",
  "speaking_tasks",
] as const;

// Tables + columns that hold a MediaStore key to upload to R2.
const MEDIA_SOURCES: { table: string; column: string }[] = [
  { table: "audio_files", column: "file_path" },
  { table: "passages", column: "source_file" },
];

const D1_DATABASE = process.env.D1_DATABASE ?? "tcf-prep";
const R2_BUCKET = process.env.R2_BUCKET ?? "tcf-prep-media";

type Args = { dryRun: boolean; local: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dryRun: false, local: false };
  for (const a of argv) {
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--local") args.local = true;
    else if (a === "--remote") args.local = false;
  }
  return args;
}

// Read a whole content table as primitives (no Drizzle Date/boolean coercion) for raw SQL generation.
async function readTable(name: string): Promise<DeployTable> {
  const res = await client.execute(`SELECT * FROM "${name}"`);
  const columns = res.columns as string[];
  const rows = res.rows.map((r) => {
    const obj: Record<string, unknown> = {};
    for (const c of columns) obj[c] = (r as Record<string, unknown>)[c];
    return obj;
  });
  return { table: name, columns, rows };
}

// Collect the distinct, relative MediaStore keys referenced by the content (audio + passage images).
function collectMediaKeys(tables: Map<string, DeployTable>): string[] {
  const keys = new Set<string>();
  for (const { table, column } of MEDIA_SOURCES) {
    const dump = tables.get(table);
    if (!dump) continue;
    for (const row of dump.rows) {
      const value = row[column];
      if (typeof value === "string" && value.length > 0) keys.add(value);
    }
  }
  return [...keys];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const target = args.local ? "--local" : "--remote";

  const tables = new Map<string, DeployTable>();
  for (const name of CONTENT_TABLES) tables.set(name, await readTable(name));

  const sql = buildDeploySql(CONTENT_TABLES.map((n) => tables.get(n)!));
  const rowTotal = [...tables.values()].reduce((n, t) => n + t.rows.length, 0);
  const mediaKeys = collectMediaKeys(tables);

  console.log(
    `Content: ${rowTotal} row(s) across ${CONTENT_TABLES.length} table(s); ${mediaKeys.length} media object(s).`,
  );

  if (args.dryRun) {
    console.log("\n--- D1 SQL (dry run) ---\n");
    console.log(sql || "(no content rows)");
    console.log("\n--- R2 uploads (dry run) ---");
    for (const key of mediaKeys) {
      const local = resolveMediaPath(key);
      const note = isAbsolute(key)
        ? " [SKIP: absolute key, not portable]"
        : existsSync(local)
          ? ""
          : " [SKIP: missing locally]";
      console.log(`  ${R2_BUCKET}/${key}  ←  ${local}${note}`);
    }
    console.log("\nDry run: nothing was written.");
    return;
  }

  // 1) Load D1 via a generated SQL file.
  if (sql.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), "tcf-deploy-"));
    const sqlPath = join(dir, "content.sql");
    writeFileSync(sqlPath, sql, "utf8");
    console.log(`\nApplying D1 content (${target})…`);
    execSync(
      `npx wrangler d1 execute ${D1_DATABASE} ${target} --file "${sqlPath}"`,
      { stdio: "inherit" },
    );
  } else {
    console.log("\nNo content rows to load into D1.");
  }

  // 2) Upload referenced media to R2 under the same relative keys.
  let uploaded = 0;
  let skipped = 0;
  for (const key of mediaKeys) {
    if (isAbsolute(key)) {
      console.warn(
        `  skip ${key}: absolute key is not a portable R2 object key.`,
      );
      skipped += 1;
      continue;
    }
    const local = resolveMediaPath(key);
    if (!existsSync(local)) {
      console.warn(`  skip ${key}: not found locally at ${local}.`);
      skipped += 1;
      continue;
    }
    execSync(
      `npx wrangler r2 object put "${R2_BUCKET}/${key}" --file "${local}" ${target}`,
      { stdio: "inherit" },
    );
    uploaded += 1;
  }

  console.log(
    `\nDone. Uploaded ${uploaded} media object(s), skipped ${skipped}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      "deploy:content failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => client.close());
