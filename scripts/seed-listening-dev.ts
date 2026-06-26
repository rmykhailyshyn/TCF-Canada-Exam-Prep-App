import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { eq, inArray } from "drizzle-orm";
import { db, client } from "../server/db";
import { getMediaDir } from "../server/config/env";
import {
  audioFiles,
  explanations,
  options,
  questionResults,
  questions,
  transcriptSegments,
} from "../server/db/schema";

// Dev-only seed: a Beginner-band (Q1–4) listening section so the listening player + quiz UI and
// the audio/transcript API can be exercised end-to-end WITHOUT running the Whisper import (which
// requires Apple Silicon). NOT part of any spec — purely a developer/testing convenience.
//
// The audio is generated tones (scripts/dev-audio/*.mp3, created with ffmpeg) and the transcript
// segments are AUTHORED, not transcribed — so this validates the player/API/UI plumbing, never
// Whisper's transcription quality. All rows use source_file = 'listening-dev.pdf' and are wiped +
// re-inserted on each run (idempotent). Run with `tsx scripts/seed-listening-dev.ts`.

const SOURCE = "listening-dev.pdf";
const AUDIO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "dev-audio");

type SeedQuestion = {
  text: string;
  opts: [string, string, string, string];
  correct: "A" | "B" | "C" | "D";
  segments: { text: string; startMs: number; endMs: number }[];
};

const QUESTIONS: SeedQuestion[] = [
  {
    text: "Écoutez le message puis répondez : où se trouve la personne ?",
    opts: ["À la gare", "À la maison", "Au bureau", "Au restaurant"],
    correct: "A",
    segments: [
      { text: "Bonjour, je suis à la gare.", startMs: 0, endMs: 2000 },
      { text: "Mon train part dans dix minutes.", startMs: 2000, endMs: 4000 },
      { text: "Je t'appelle en arrivant.", startMs: 4000, endMs: 6000 },
    ],
  },
  {
    text: "Quel jour le rendez-vous a-t-il lieu ?",
    opts: ["Lundi", "Mercredi", "Vendredi", "Dimanche"],
    correct: "C",
    segments: [
      { text: "Le rendez-vous est fixé.", startMs: 0, endMs: 2000 },
      { text: "Nous nous voyons vendredi matin.", startMs: 2000, endMs: 4200 },
      { text: "N'oubliez pas vos documents.", startMs: 4200, endMs: 6000 },
    ],
  },
  {
    text: "Que commande la cliente ?",
    opts: ["Un café", "Un thé", "Un jus", "De l'eau"],
    correct: "B",
    segments: [
      { text: "Bonjour, vous désirez ?", startMs: 0, endMs: 1800 },
      {
        text: "Je voudrais un thé, s'il vous plaît.",
        startMs: 1800,
        endMs: 4000,
      },
      {
        text: "Très bien, j'arrive tout de suite.",
        startMs: 4000,
        endMs: 6000,
      },
    ],
  },
  {
    text: "Quel temps fera-t-il demain ?",
    opts: ["Il pleuvra", "Il neigera", "Il fera beau", "Il y aura du vent"],
    correct: "C",
    segments: [
      { text: "Voici la météo de demain.", startMs: 0, endMs: 2000 },
      {
        text: "Le ciel sera dégagé toute la journée.",
        startMs: 2000,
        endMs: 4300,
      },
      { text: "Profitez du beau temps.", startMs: 4300, endMs: 6000 },
    ],
  },
];

async function main(): Promise<void> {
  const labels: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];

  // Verify the generated audio exists before seeding (file_path is NOT NULL + unique).
  for (let i = 0; i < QUESTIONS.length; i += 1) {
    const path = resolve(
      AUDIO_DIR,
      `listening-dev-q${String(i + 1).padStart(2, "0")}.mp3`,
    );
    if (!existsSync(path)) {
      throw new Error(
        `Missing ${path}. Generate the dev clips first:\n` +
          `  for i in 1 2 3 4; do ffmpeg -y -f lavfi -i "sine=frequency=$((300+i*120)):duration=6" ` +
          `-ac 1 -ar 22050 -b:a 64k scripts/dev-audio/listening-dev-q0$i.mp3; done`,
      );
    }
  }

  await db.transaction(async (tx) => {
    // Wipe any previous dev rows (children first, FK order).
    const existing = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.sourceFile, SOURCE));
    const ids = existing.map((q) => q.id);
    if (ids.length > 0) {
      // Children that reference questions must go first (M7 explanations + any recorded answers
      // from sessions run against the previous seed), otherwise the FK blocks the question delete.
      await tx
        .delete(questionResults)
        .where(inArray(questionResults.questionId, ids));
      await tx
        .delete(explanations)
        .where(inArray(explanations.questionId, ids));
      await tx
        .delete(transcriptSegments)
        .where(inArray(transcriptSegments.questionId, ids));
      await tx.delete(audioFiles).where(inArray(audioFiles.questionId, ids));
      await tx.delete(options).where(inArray(options.questionId, ids));
      await tx.delete(questions).where(eq(questions.sourceFile, SOURCE));
    }

    // Copy the dev clips into the media store; the DB stores paths relative to MEDIA_DIR, matching
    // the real import (audio_files.file_path is relative). spec parity: docs/specs/listening-import.md
    mkdirSync(resolve(getMediaDir(), "listening"), { recursive: true });

    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const q = QUESTIONS[i];
      const srcPath = resolve(
        AUDIO_DIR,
        `listening-dev-q${String(i + 1).padStart(2, "0")}.mp3`,
      );
      const relAudioPath = join("listening", basename(srcPath));
      copyFileSync(srcPath, resolve(getMediaDir(), relAudioPath));

      const [qRow] = await tx
        .insert(questions)
        .values({
          passageId: null,
          sourceFile: SOURCE,
          sequence: i + 1,
          text: q.text,
          section: "listening",
        })
        .returning({ id: questions.id });

      await tx.insert(options).values(
        labels.map((label, idx) => ({
          questionId: qRow.id,
          label,
          text: q.opts[idx],
          isCorrect: label === q.correct,
        })),
      );

      await tx.insert(audioFiles).values({
        questionId: qRow.id,
        filePath: relAudioPath,
        durationMs: 6000,
      });

      await tx.insert(transcriptSegments).values(
        q.segments.map((s, idx) => ({
          questionId: qRow.id,
          sequence: idx + 1,
          text: s.text,
          startMs: s.startMs,
          endMs: s.endMs,
        })),
      );
    }
  });

  console.log(
    `Seeded ${QUESTIONS.length} listening questions (Beginner band Q1–4) with audio + transcripts.`,
  );
  client.close();
}

main().catch((error: unknown) => {
  console.error("Listening seed failed:", error);
  process.exit(1);
});
