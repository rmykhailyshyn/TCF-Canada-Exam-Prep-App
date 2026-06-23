import { asc, eq } from 'drizzle-orm';
import { db, client } from '../server/db';
import { explanations, options, passages, questions, transcriptSegments } from '../server/db/schema';
import {
  ClaudeError,
  type EnrichInput,
  type OptionLabel,
  buildEnrichPrompt,
  generateExplanation,
  runClaude,
} from './lib/claude';

// spec: docs/specs/llm-enrichment.md
// Pre-generates per-question explanations with the LOCAL Claude CLI and stores them in the
// `explanations` table. Idempotent (skips questions that already have one). Shell calls go through
// scripts/lib/claude.ts; DB access stays in Drizzle.
//
//   npm run enrich                       # all questions without an explanation
//   npm run enrich -- --section reading  # limit to a section
//   npm run enrich -- --question-id 42   # a single question
//   npm run enrich -- --dry-run          # print prompt + model output, write nothing

type Args = {
  questionId: number | null;
  section: 'reading' | 'listening' | null;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { questionId: null, section: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--question-id') args.questionId = Number(argv[(i += 1)]);
    else if (a.startsWith('--question-id=')) args.questionId = Number(a.slice('--question-id='.length));
    else if (a === '--section') args.section = argv[(i += 1)] as Args['section'];
    else if (a.startsWith('--section=')) args.section = a.slice('--section='.length) as Args['section'];
  }
  if (args.questionId != null && !Number.isInteger(args.questionId)) {
    throw new Error('--question-id must be an integer.');
  }
  if (args.section != null && args.section !== 'reading' && args.section !== 'listening') {
    throw new Error('--section must be "reading" or "listening".');
  }
  return args;
}

// spec: docs/specs/llm-enrichment.md §Behaviour.3b — reading uses the passage; listening uses the
// transcript (segments concatenated in sequence order).
async function loadSourceText(
  section: 'reading' | 'listening',
  questionId: number,
  passageId: number | null,
): Promise<string> {
  if (section === 'reading') {
    if (passageId == null) return '';
    const [p] = await db.select({ text: passages.text }).from(passages).where(eq(passages.id, passageId));
    return p?.text ?? '';
  }
  const segs = await db
    .select({ text: transcriptSegments.text })
    .from(transcriptSegments)
    .where(eq(transcriptSegments.questionId, questionId))
    .orderBy(asc(transcriptSegments.sequence));
  return segs.map((s) => s.text).join(' ').trim();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const model = process.env.CLAUDE_CLI_MODEL;
  const generatedBy = model ? `claude-cli/${model}` : 'claude-cli';

  // Questions that already have an explanation are skipped (Behaviour.6).
  const withExplanation = new Set(
    (await db.select({ questionId: explanations.questionId }).from(explanations)).map(
      (r) => r.questionId,
    ),
  );

  let rows = await db.select().from(questions).orderBy(asc(questions.section), asc(questions.sequence));
  if (args.section) rows = rows.filter((q) => q.section === args.section);
  if (args.questionId != null) rows = rows.filter((q) => q.id === args.questionId);

  if (rows.length === 0) {
    console.log('No questions match the given filters.');
    return;
  }

  let generated = 0;
  let skipped = 0;
  let failed = 0;

  for (const q of rows) {
    if (withExplanation.has(q.id)) {
      console.log(`Question ${q.sequence} (#${q.id}): skipped (exists)`);
      skipped += 1;
      continue;
    }

    const opts = await db.select().from(options).where(eq(options.questionId, q.id));
    const correct = opts.find((o) => o.isCorrect);
    if (!correct) {
      console.warn(`Question ${q.sequence} (#${q.id}): skipped — no answer key imported.`);
      skipped += 1;
      continue;
    }

    const section = q.section as 'reading' | 'listening';
    const sourceText = await loadSourceText(section, q.id, q.passageId);

    const input: EnrichInput = {
      sequence: q.sequence,
      section,
      questionText: q.text,
      options: opts.map((o) => ({ label: o.label as OptionLabel, text: o.text })),
      correctLabel: correct.label as OptionLabel,
      sourceText,
    };

    // spec: docs/specs/llm-enrichment.md §Behaviour.8 — dry-run prints prompt + raw output, no write.
    if (args.dryRun) {
      console.log(`\n===== Question ${q.sequence} (#${q.id}) prompt =====`);
      console.log(buildEnrichPrompt(input));
      try {
        console.log(`----- model output -----`);
        console.log(runClaude(buildEnrichPrompt(input), { model }));
      } catch (error) {
        console.error(error instanceof ClaudeError ? error.message : error);
      }
      continue;
    }

    // spec: docs/specs/llm-enrichment.md §Behaviour.7 — a CLI/parse failure skips just this question.
    try {
      const { explanation } = generateExplanation(input, { model });
      await db.insert(explanations).values({
        questionId: q.id,
        correctReason: explanation.correctReason,
        optionAReason: explanation.optionAReason,
        optionBReason: explanation.optionBReason,
        optionCReason: explanation.optionCReason,
        optionDReason: explanation.optionDReason,
        generatedBy,
      });
      console.log(`Question ${q.sequence} (#${q.id}): generated`);
      generated += 1;
    } catch (error) {
      if (error instanceof ClaudeError) {
        console.error(`✗ Question ${q.sequence} (#${q.id}): ${error.message}`);
        failed += 1;
        continue;
      }
      throw error;
    }
  }

  if (!args.dryRun) {
    console.log(`\nDone. Generated ${generated}, skipped ${skipped}, failed ${failed}.`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => client.close());
