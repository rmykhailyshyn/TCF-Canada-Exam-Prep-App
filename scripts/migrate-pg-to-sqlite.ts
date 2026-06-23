import pg from 'pg';
import { client } from '../server/db';

// One-time, best-effort, LOCAL-ONLY data migration: copy every row from an existing PostgreSQL dev
// database into the new SQLite database (referenced by DATABASE_URL), preserving primary-key ids and
// foreign-key links. There is no production database — this exists only so a developer does not lose
// their local dev data (imported questions/tasks, session history, explanations, evaluations) when
// switching engines. Run AFTER `npm run db:migrate` has created the SQLite schema.
//
//   npm run db:migrate-from-postgres -- --from <PG_DATABASE_URL>   (or set PG_DATABASE_URL)
//   npm run db:migrate-from-postgres -- --from <PG_DATABASE_URL> --dry-run
//
// spec: docs/specs/database-sqlite.md §Behaviour.9

// Tables in foreign-key dependency order: a table is listed only after every table it references.
const TABLES_IN_FK_ORDER = [
  'passages',
  'writing_tasks',
  'speaking_tasks',
  'questions', // -> passages
  'options', // -> questions
  'audio_files', // -> questions
  'transcript_segments', // -> questions
  'explanations', // -> questions
  'sessions',
  'question_results', // -> sessions, questions
  'writing_responses', // -> sessions, writing_tasks
  'speaking_responses', // -> sessions, speaking_tasks
  'writing_evaluations', // -> writing_responses
  'speaking_evaluations', // -> speaking_responses
] as const;

type Args = { from: string; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  let from = process.env.PG_DATABASE_URL ?? '';
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--from') {
      from = argv[i + 1] ?? '';
      i += 1;
    } else if (arg.startsWith('--from=')) {
      from = arg.slice('--from='.length);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  if (!from) {
    throw new Error(
      'Source PostgreSQL URL is required. Pass --from <PG_DATABASE_URL> or set PG_DATABASE_URL.',
    );
  }
  return { from, dryRun };
}

// Convert a PG value to its SQLite representation. node-postgres returns `boolean` for boolean
// columns and a JS `Date` for timestamptz columns; everything else (integers, text, null) is copied
// verbatim. This matches the schema's `mode: 'boolean'` (0/1) and `mode: 'timestamp'` (unix seconds).
function toSqliteValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value as string | number;
}

async function main(): Promise<void> {
  const { from, dryRun } = parseArgs(process.argv.slice(2));

  const pgClient = new pg.Client({ connectionString: from });
  await pgClient.connect();

  const summary: Array<{ table: string; rows: number }> = [];

  try {
    // FK enforcement is disabled during the copy so insertion order can't trip a constraint mid-run;
    // we re-enable and run an integrity check at the end. (No-op in --dry-run, which never writes.)
    if (!dryRun) {
      await client.execute('PRAGMA foreign_keys = OFF');
    }

    for (const table of TABLES_IN_FK_ORDER) {
      const { rows } = await pgClient.query(`SELECT * FROM ${table}`);
      summary.push({ table, rows: rows.length });

      if (dryRun || rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const colList = columns.map((c) => `"${c}"`).join(', ');
      const placeholders = columns.map(() => '?').join(', ');
      const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;

      const statements = rows.map((row) => ({
        sql,
        args: columns.map((c) => toSqliteValue(row[c])) as Array<string | number | null>,
      }));
      // batch runs in a single implicit transaction; a failure rolls back the whole table.
      await client.batch(statements, 'write');
    }

    if (!dryRun) {
      const check = await client.execute('PRAGMA foreign_key_check');
      if (check.rows.length > 0) {
        throw new Error(
          `Foreign-key violations after copy (${check.rows.length}); the SQLite DB was left ` +
            'with FK enforcement off. Inspect the source data and re-run into an empty database.',
        );
      }
      await client.execute('PRAGMA foreign_keys = ON');
    }
  } finally {
    await pgClient.end();
    client.close();
  }

  const total = summary.reduce((sum, s) => sum + s.rows, 0);
  const verb = dryRun ? 'would copy' : 'copied';
  console.log(`\nPostgreSQL -> SQLite migration (${verb}):`);
  for (const { table, rows } of summary) {
    console.log(`  ${table.padEnd(22)} ${String(rows).padStart(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(22)} ${String(total).padStart(6)}`);
  if (dryRun) console.log('\n(--dry-run: nothing was written.)');
}

main().catch((error: unknown) => {
  console.error('Data migration failed:', error);
  process.exit(1);
});
