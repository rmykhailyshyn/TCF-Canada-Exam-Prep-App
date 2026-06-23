import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../server/db';
import { speakingTasks } from '../server/db/schema';
import { SpeakingTaskParseError, parseSpeakingTasks } from './lib/speaking-tasks';

// spec: docs/specs/speaking-import.md
// Speaking task import CLI: `npm run import:speaking -- --file <path.json>`. The source is a single
// JSON file — an array of `{ task, question, answer }` objects. Idempotent on the natural key
// (source_file, sequence): insert when absent, overwrite in place otherwise. Malformed elements are
// skipped and the run continues. DB access stays in Drizzle.
//
//   npm run import:speaking -- --file <path.json>
//   npm run import:speaking -- --file <path.json> --dry-run

type Args = { file: string | null; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { file: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--file') args.file = argv[(i += 1)] ?? null;
    else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) throw new Error('Usage: npm run import:speaking -- --file <path.json>');

  const path = resolve(args.file);
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);

  const sourceFile = basename(path);
  // Throws SpeakingTaskParseError if the document is not a JSON array (Behaviour.2).
  const results = parseSpeakingTasks(readFileSync(path, 'utf8'));

  let inserted = 0;
  let overwritten = 0;
  let skipped = 0;

  for (const result of results) {
    if (!result.ok) {
      // spec: docs/specs/speaking-import.md §Behaviour.4 — skip a malformed element, continue.
      console.warn(`• element ${result.sequence}: skipped (${result.reason})`);
      skipped += 1;
      continue;
    }

    const { task } = result;
    if (args.dryRun) {
      console.log(`element ${task.sequence} → task ${task.taskNumber}: would import`, task);
      continue;
    }

    const values = {
      sourceFile,
      sequence: task.sequence,
      taskNumber: task.taskNumber,
      question: task.question,
      sampleAnswer: task.sampleAnswer,
    };

    // spec: docs/specs/speaking-import.md §Behaviour.5 — upsert on (source_file, sequence),
    // overwriting in place (same row id) when present.
    const [existing] = await db
      .select({ id: speakingTasks.id })
      .from(speakingTasks)
      .where(and(eq(speakingTasks.sourceFile, sourceFile), eq(speakingTasks.sequence, task.sequence)));

    if (existing) {
      await db.update(speakingTasks).set(values).where(eq(speakingTasks.id, existing.id));
      console.log(`element ${task.sequence} → task ${task.taskNumber}: overwritten`);
      overwritten += 1;
    } else {
      await db.insert(speakingTasks).values(values);
      console.log(`element ${task.sequence} → task ${task.taskNumber}: inserted`);
      inserted += 1;
    }
  }

  const total = results.length;
  console.log(
    `\nDone. Inserted ${inserted}, overwritten ${overwritten}, skipped ${skipped} of ${total} element(s).`,
  );

  // spec: docs/specs/speaking-import.md §Behaviour.8 — non-zero exit if every element was skipped.
  if (!args.dryRun && total > 0 && inserted + overwritten === 0) {
    throw new Error('No tasks were imported (every element was skipped).');
  }
}

main()
  .catch((error: unknown) => {
    const message =
      error instanceof SpeakingTaskParseError || error instanceof Error
        ? error.message
        : String(error);
    console.error('Import failed:', message);
    process.exitCode = 1;
  })
  .finally(() => client.close());
