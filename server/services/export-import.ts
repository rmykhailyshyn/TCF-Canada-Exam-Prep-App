import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  audioFiles,
  options,
  passages,
  questions,
  transcriptSegments,
} from "../db/schema";
import { getMediaDir } from "../config/env";
import {
  type DifficultyFilter,
  type ExportDocument,
  type ExportQuestion,
  type SectionFilter,
  FORMAT_VERSION,
  deriveDifficulty,
  sequenceMatchesDifficulty,
  validateDocument,
} from "../lib/export-import";

// spec: docs/specs/question-export-import.md §API contract
// Business logic for Question Bank export/import. Reads/writes go through Drizzle; the pure shape
// + validation rules live in ../lib/export-import. Services return plain values or throw ApiError;
// the route layer owns the envelope.

// spec: docs/specs/question-export-import.md §API contract GET /api/questions/export
// Builds a versioned export document for every question matching the section + complexity filter,
// each carrying its options/answer key and passage (reading) or transcript + audio reference
// (listening). `questions` is `[]` when nothing matches.
export async function exportQuestions(
  section: SectionFilter,
  difficulty: DifficultyFilter,
): Promise<ExportDocument> {
  const rows =
    section === "all"
      ? await db
          .select()
          .from(questions)
          .orderBy(asc(questions.section), asc(questions.sequence))
      : await db
          .select()
          .from(questions)
          .where(eq(questions.section, section))
          .orderBy(asc(questions.sequence));

  // Complexity is derived from `sequence`, not stored — filter in memory (Behaviour.3).
  const matched = rows.filter((q) =>
    sequenceMatchesDifficulty(q.sequence, difficulty),
  );

  const exported: ExportQuestion[] = [];
  if (matched.length > 0) {
    const ids = matched.map((q) => q.id);
    const passageIds = [
      ...new Set(
        matched
          .map((q) => q.passageId)
          .filter((id): id is number => id != null),
      ),
    ];

    const [allOptions, passageRows, audioRows, segmentRows] = await Promise.all(
      [
        db.select().from(options).where(inArray(options.questionId, ids)),
        passageIds.length
          ? db.select().from(passages).where(inArray(passages.id, passageIds))
          : Promise.resolve([]),
        db.select().from(audioFiles).where(inArray(audioFiles.questionId, ids)),
        db
          .select()
          .from(transcriptSegments)
          .where(inArray(transcriptSegments.questionId, ids)),
      ],
    );

    const passageById = new Map(passageRows.map((p) => [p.id, p]));
    const optionsByQuestion = groupBy(allOptions, (o) => o.questionId);
    const audioByQuestion = new Map(audioRows.map((a) => [a.questionId, a]));
    const segmentsByQuestion = groupBy(segmentRows, (s) => s.questionId);

    for (const q of matched) {
      const section_ = q.section as "reading" | "listening";
      const passage =
        q.passageId != null ? passageById.get(q.passageId) : undefined;
      const audio = audioByQuestion.get(q.id);
      const segments = (segmentsByQuestion.get(q.id) ?? []).sort(
        (a, b) => a.sequence - b.sequence,
      );

      exported.push({
        section: section_,
        sourceFile: q.sourceFile,
        sequence: q.sequence,
        difficulty: deriveDifficulty(q.sequence),
        text: q.text,
        options: (optionsByQuestion.get(q.id) ?? [])
          .map((o) => ({
            label: o.label as "A",
            text: o.text,
            isCorrect: o.isCorrect,
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        passage:
          section_ === "reading" && passage
            ? { sourceFile: passage.sourceFile, text: passage.text }
            : null,
        audio:
          section_ === "listening" && audio
            ? {
                fileName: basename(audio.filePath),
                durationMs: audio.durationMs,
              }
            : null,
        transcript:
          section_ === "listening"
            ? segments.map((s) => ({
                sequence: s.sequence,
                text: s.text,
                startMs: s.startMs,
                endMs: s.endMs,
              }))
            : [],
      });
    }
  }

  return {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    filter: { section, difficulties: difficulty },
    questions: exported,
  };
}

export type ImportSummary = {
  inserted: number;
  overridden: number;
  skipped: number;
  total: number;
  warnings: string[];
};

// spec: docs/specs/question-export-import.md §API contract POST /api/questions/import
// Validates the document (throws INVALID_FORMAT / VALIDATION_FAILED before any write), then applies
// every question in a single transaction matched on the natural key (source_file, sequence):
// insert when absent, skip or overwrite-in-place when present. Any failure rolls back the whole
// import, leaving the database unchanged (Behaviour.11).
export async function importQuestions(
  rawDocument: unknown,
  override: boolean,
): Promise<ImportSummary> {
  const incoming = validateDocument(rawDocument);
  const mediaDir = getMediaDir();
  const warnings: string[] = [];
  let inserted = 0;
  let overridden = 0;
  let skipped = 0;

  await db.transaction(async (tx) => {
    for (const q of incoming) {
      const [existing] = await tx
        .select({ id: questions.id })
        .from(questions)
        .where(
          and(
            eq(questions.sourceFile, q.sourceFile),
            eq(questions.sequence, q.sequence),
          ),
        );

      if (existing && !override) {
        skipped += 1;
        continue;
      }

      // Reading passages key on their own unique source_file; upsert and link by id.
      const passageId =
        q.section === "reading" && q.passage
          ? await upsertPassage(tx, q.passage.sourceFile, q.passage.text)
          : null;

      let questionId: number;
      if (!existing) {
        const [created] = await tx
          .insert(questions)
          .values({
            passageId,
            sourceFile: q.sourceFile,
            sequence: q.sequence,
            text: q.text,
            section: q.section,
          })
          .returning({ id: questions.id });
        questionId = created.id;
        inserted += 1;
      } else {
        // Override in place — same questions.id keeps question_results / sessions linked.
        questionId = existing.id;
        await tx
          .update(questions)
          .set({ passageId, text: q.text, section: q.section })
          .where(eq(questions.id, questionId));
        overridden += 1;
      }

      // Options: full replace of the four (Behaviour.10).
      await tx.delete(options).where(eq(options.questionId, questionId));
      await tx.insert(options).values(
        q.options.map((o) => ({
          questionId,
          label: o.label,
          text: o.text,
          isCorrect: o.isCorrect,
        })),
      );

      if (q.section === "listening" && q.audio) {
        // Replace transcript segments and the audio reference for this question.
        await tx
          .delete(transcriptSegments)
          .where(eq(transcriptSegments.questionId, questionId));
        if (q.transcript.length > 0) {
          await tx.insert(transcriptSegments).values(
            q.transcript.map((s) => ({
              questionId,
              sequence: s.sequence,
              text: s.text,
              startMs: s.startMs,
              endMs: s.endMs,
            })),
          );
        }

        // Store the path RELATIVE to MEDIA_DIR (the portable form the serve layer resolves);
        // the export carries the basename only, which lands under the listening/ subfolder.
        const relPath = join("listening", q.audio.fileName);
        if (!existsSync(resolve(mediaDir, relPath))) {
          warnings.push(
            `Audio file not found on disk: ${resolve(mediaDir, relPath)} (question listening/${q.sequence}). ` +
              "Imported the reference; playback needs the MP3 placed in the media directory.",
          );
        }
        await upsertAudio(tx, questionId, relPath, q.audio.durationMs);
      } else {
        // Reading (or audio-less): ensure no stale listening rows remain after an override.
        await tx
          .delete(transcriptSegments)
          .where(eq(transcriptSegments.questionId, questionId));
        await tx
          .delete(audioFiles)
          .where(eq(audioFiles.questionId, questionId));
      }
    }
  });

  return { inserted, overridden, skipped, total: incoming.length, warnings };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Passages are keyed by their own UNIQUE(source_file); reuse the row when present so override
// updates the passage text in place, otherwise insert. Returns the linked passage id.
async function upsertPassage(
  tx: Tx,
  sourceFile: string,
  text: string,
): Promise<number> {
  const [existing] = await tx
    .select({ id: passages.id })
    .from(passages)
    .where(eq(passages.sourceFile, sourceFile));
  if (existing) {
    await tx.update(passages).set({ text }).where(eq(passages.id, existing.id));
    return existing.id;
  }
  const [created] = await tx
    .insert(passages)
    .values({ sourceFile, text })
    .returning({ id: passages.id });
  return created.id;
}

// audio_files has UNIQUE(question_id); update the existing row in place on override, else insert.
async function upsertAudio(
  tx: Tx,
  questionId: number,
  filePath: string,
  durationMs: number | null,
): Promise<void> {
  const [existing] = await tx
    .select({ id: audioFiles.id })
    .from(audioFiles)
    .where(eq(audioFiles.questionId, questionId));
  if (existing) {
    await tx
      .update(audioFiles)
      .set({ filePath, durationMs })
      .where(eq(audioFiles.id, existing.id));
  } else {
    await tx.insert(audioFiles).values({ questionId, filePath, durationMs });
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
