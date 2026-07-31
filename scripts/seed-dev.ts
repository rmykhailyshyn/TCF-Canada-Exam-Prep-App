import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import { db, client } from "../server/db";
import {
  explanations,
  options,
  passages,
  questionResults,
  questions,
} from "../server/db/schema";
import { getMediaDir } from "../server/config/env";
import { solidColorPng } from "./lib/png";
import { PASSAGES } from "./lib/seed-dev-passages";
import { QUESTIONS } from "./lib/seed-dev-questions";

// Dev-only seed: a full 39-question reading section so the quiz UI and session API can be
// exercised end-to-end without a real import. NOT part of any spec — purely a developer
// convenience. All rows use source_file = 'dev-seed.pdf' and are wiped + re-inserted on each
// run (idempotent). Run with `npm run seed:dev`.
//
// This exists because the only real results PDF available during Milestone 2 was a listening
// sample (no reading passages); reading-import remains validated only for the shared PDF parser.

const SOURCE = "dev-seed.pdf";

async function main(): Promise<void> {
  if (QUESTIONS.length !== 39) {
    throw new Error(`Expected 39 seed questions, got ${QUESTIONS.length}`);
  }

  await db.transaction(async (tx) => {
    // Wipe any previous dev-seed rows (children first, FK order).
    const existing = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.sourceFile, SOURCE));
    const existingIds = existing.map((q) => q.id);
    if (existingIds.length > 0) {
      // Children that reference questions must go first (M7 explanations + any recorded answers
      // from sessions run against the previous seed), otherwise the FK blocks the question delete.
      await tx
        .delete(questionResults)
        .where(inArray(questionResults.questionId, existingIds));
      await tx
        .delete(explanations)
        .where(inArray(explanations.questionId, existingIds));
      await tx.delete(options).where(inArray(options.questionId, existingIds));
      await tx.delete(questions).where(eq(questions.sourceFile, SOURCE));
    }
    await tx
      .delete(passages)
      .where(like(passages.sourceFile, "%dev-seed-passage-%"));

    // Generate a real, browser-renderable placeholder image per passage into MEDIA_DIR/reading/, so
    // the reading UI's "image on top, OCR text below" path (reading-quiz-ui §Layout.3a) is exercised
    // without a real OCR import. Distinct hue per passage; sourceFile stores the path RELATIVE to
    // MEDIA_DIR that the passage-image route resolves and serves (matching the real OCR import).
    const mediaDir = getMediaDir();
    mkdirSync(resolve(mediaDir, "reading"), { recursive: true });
    const HUES: [number, number, number][] = [
      [219, 234, 254], // blue
      [220, 252, 231], // green
      [254, 243, 199], // amber
      [243, 232, 255], // violet
      [254, 226, 226], // rose
      [204, 251, 241], // teal
    ];

    // Insert passages.
    const passageIds: number[] = [];
    for (let i = 0; i < PASSAGES.length; i += 1) {
      const relImagePath = join("reading", `dev-seed-passage-${i}.png`);
      writeFileSync(
        resolve(mediaDir, relImagePath),
        solidColorPng(640, 360, HUES[i % HUES.length]),
      );
      const [row] = await tx
        .insert(passages)
        .values({ sourceFile: relImagePath, text: PASSAGES[i].text })
        .returning({ id: passages.id });
      passageIds.push(row.id);
    }

    // Insert questions + options.
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const q = QUESTIONS[i];
      const [qRow] = await tx
        .insert(questions)
        .values({
          passageId: passageIds[q.passage],
          sourceFile: SOURCE,
          sequence: i + 1,
          text: q.text,
          section: "reading",
        })
        .returning({ id: questions.id });

      const labels: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
      await tx.insert(options).values(
        labels.map((label, idx) => ({
          questionId: qRow.id,
          label,
          text: q.opts[idx],
          isCorrect: label === q.correct,
        })),
      );
    }
  });

  console.log(
    `Seeded ${PASSAGES.length} passages (+ placeholder images in ${getMediaDir()}) and ` +
      `${QUESTIONS.length} reading questions.`,
  );
  client.close();
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
