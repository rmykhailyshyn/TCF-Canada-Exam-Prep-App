import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../server/db';
import { writingTasks } from '../server/db/schema';
import { TaskParseError, parseTaskFile } from './lib/writing-tasks';

// spec: docs/specs/writing-import.md
// Writing task import CLI: `npm run import:writing -- --dir <path>`. Each `*.md` file in the
// directory is one task (front-matter + `## Prompt` / `## Sample answer` / `## Template`). Idempotent
// on the natural key (source_file, task_number): insert when absent, overwrite in place otherwise.
// Malformed files are skipped and the run continues. DB access stays in Drizzle.
//
//   npm run import:writing -- --dir <path>
//   npm run import:writing -- --dir <path> --dry-run

type Args = { dir: string | null; dryRun: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { dir: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--dir') args.dir = argv[(i += 1)] ?? null;
    else if (a.startsWith('--dir=')) args.dir = a.slice('--dir='.length);
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) throw new Error('Usage: npm run import:writing -- --dir <path>');

  const dir = resolve(args.dir);
  if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`);

  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  if (files.length === 0) throw new Error(`No .md task files found in ${dir}`);

  let inserted = 0;
  let overwritten = 0;
  let skipped = 0;

  for (const file of files.sort()) {
    const sourceFile = basename(file);
    let parsed;
    try {
      parsed = parseTaskFile(readFileSync(resolve(dir, file), 'utf8'));
    } catch (error) {
      // spec: docs/specs/writing-import.md §Behaviour.4 — skip a malformed file, continue.
      const reason = error instanceof TaskParseError ? error.message : String(error);
      console.warn(`• ${sourceFile}: skipped (${reason})`);
      skipped += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`${sourceFile} → task ${parsed.taskNumber}: would import`, parsed);
      continue;
    }

    const values = {
      sourceFile,
      taskNumber: parsed.taskNumber,
      title: parsed.title,
      prompt: parsed.prompt,
      instructions: parsed.instructions,
      minWords: parsed.minWords,
      maxWords: parsed.maxWords,
      sampleAnswer: parsed.sampleAnswer,
      template: parsed.template,
    };

    // spec: docs/specs/writing-import.md §Behaviour.5 — upsert on (source_file, task_number),
    // overwriting in place (same row id) when present.
    const [existing] = await db
      .select({ id: writingTasks.id })
      .from(writingTasks)
      .where(
        and(eq(writingTasks.sourceFile, sourceFile), eq(writingTasks.taskNumber, parsed.taskNumber)),
      );

    if (existing) {
      await db.update(writingTasks).set(values).where(eq(writingTasks.id, existing.id));
      console.log(`${sourceFile} → task ${parsed.taskNumber}: overwritten`);
      overwritten += 1;
    } else {
      await db.insert(writingTasks).values(values);
      console.log(`${sourceFile} → task ${parsed.taskNumber}: inserted`);
      inserted += 1;
    }
  }

  const total = files.length;
  console.log(
    `\nDone. Inserted ${inserted}, overwritten ${overwritten}, skipped ${skipped} of ${total} file(s).`,
  );

  // spec: docs/specs/writing-import.md §Behaviour.8 — non-zero exit if every file was skipped.
  if (!args.dryRun && inserted + overwritten === 0) {
    throw new Error('No tasks were imported (every file was skipped).');
  }
}

main()
  .catch((error: unknown) => {
    console.error('Import failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
