import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../server/db';
import { audioFiles, options, questions, transcriptSegments } from '../server/db/schema';
import { getMediaDir } from '../server/config/env';
import { runPdfParser } from './lib/parse';
import { crossCheckScore, extractSequenceFromFilename, resolveCorrectLabel } from './lib/results';
import { WhisperError, runWhisper } from './lib/whisper';

// spec: docs/specs/listening-import.md
// Listening import CLI: `npm run transcribe -- --dir <path>`. The folder holds the single results
// PDF (questions + options + answer key via green fill + score) and one MP3 per question. Each
// MP3 is matched to its question by the sequence number in its filename, transcribed with Whisper
// into phrase-level segments, and persisted alongside the question. Apple Silicon / macOS only for
// the Whisper step (CLAUDE.md). Shell calls go through scripts/lib wrappers; DB access stays in
// Drizzle.

function parseDirArg(argv: string[]): string {
  const idx = argv.indexOf('--dir');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith('--dir='));
  if (eq) return eq.slice('--dir='.length);
  throw new Error('Usage: npm run transcribe -- --dir <path>');
}

// spec: docs/specs/listening-import.md §Behaviour.2 — exactly one PDF must be present.
function findSinglePdf(dir: string, entries: string[]): string {
  const pdfs = entries.filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (pdfs.length === 0) throw new Error(`No PDF file found in ${dir}`);
  if (pdfs.length > 1) {
    throw new Error(`Expected exactly one PDF in ${dir}, found ${pdfs.length}: ${pdfs.join(', ')}`);
  }
  return resolve(dir, pdfs[0]);
}

// spec: docs/specs/listening-import.md §Behaviour.5 — map sequence → MP3 by the number in its
// filename. `extractSequenceFromFilename` reads the digits after a `Q` (or the last number),
// which matches both the spec's `q<NN>.mp3` convention and the site's native `<test>Q<N>.mp3`
// export names — resolving the "media naming convention" open question.
function mapAudioBySequence(dir: string, entries: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.mp3')) continue;
    const seq = extractSequenceFromFilename(entry);
    if (seq == null) {
      console.warn(`• Ignoring MP3 with no sequence number in its name: ${entry}`);
      continue;
    }
    if (map.has(seq)) {
      console.warn(`• Multiple MP3s map to question ${seq}; using ${map.get(seq)}, ignoring ${entry}`);
      continue;
    }
    map.set(seq, resolve(dir, entry));
  }
  return map;
}

async function main(): Promise<void> {
  const dir = resolve(parseDirArg(process.argv.slice(2)));
  if (!existsSync(dir)) throw new Error(`Directory not found: ${dir}`);

  const entries = readdirSync(dir);
  const pdfPath = findSinglePdf(dir, entries);
  const audioBySequence = mapAudioBySequence(dir, entries);
  // spec: docs/specs/listening-import.md §Behaviour.2 — at least one MP3 is required.
  if (audioBySequence.size === 0) throw new Error(`No MP3 files found in ${dir}`);

  // Parse + validate before any DB writes (Behaviour.14: a bad PDF leaves the DB untouched).
  const parsed = runPdfParser(pdfPath);

  // Score cross-check (Behaviour.10) — a warning, not a hard failure.
  const check = crossCheckScore(parsed);
  if (!check.matches) {
    console.warn(
      `⚠ Score cross-check mismatch: recomputed ${check.recomputedCorrect} correct / ` +
        `${check.recomputedPoints} pts vs PDF ${check.pdfCorrect} / ${check.pdfPoints}. ` +
        `This usually means a colour-detection or parsing fault.`,
    );
  }

  let questionsImported = 0;
  let segmentsImported = 0;
  let skipped = 0;

  mkdirSync(resolve(getMediaDir(), 'listening'), { recursive: true });

  for (const q of parsed.questions) {
    // Answer key: exactly one green option (Behaviour.13).
    const resolved = resolveCorrectLabel(q);
    if (!resolved.ok) {
      console.error(`✗ Skipping question ${q.sequence}: ${resolved.reason}`);
      skipped += 1;
      continue;
    }

    // Idempotency: skip a question already imported from this PDF (Behaviour.11).
    const existingQuestion = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.sourceFile, pdfPath), eq(questions.sequence, q.sequence)));
    if (existingQuestion.length > 0) {
      console.warn(`• Question ${q.sequence} already imported — skipping.`);
      skipped += 1;
      continue;
    }

    // MP3 matched by the sequence number in its filename (Behaviour.5, 6).
    const audioPath = audioBySequence.get(q.sequence);
    if (!audioPath) {
      console.warn(`• Question ${q.sequence}: no matching MP3 found in the folder — skipping.`);
      skipped += 1;
      continue;
    }

    // The MP3 is copied into MEDIA_DIR/listening/ and the DB stores the path RELATIVE to MEDIA_DIR,
    // so the data is portable (the source --dir can move/disappear). spec: docs/specs/listening-import.md
    const relAudioPath = join('listening', basename(audioPath));

    // Duplicate audio path → skip without inserting (Behaviour.11).
    const existingAudio = await db
      .select({ id: audioFiles.id })
      .from(audioFiles)
      .where(eq(audioFiles.filePath, relAudioPath));
    if (existingAudio.length > 0) {
      console.warn(`• Audio for question ${q.sequence} already imported — skipping.`);
      skipped += 1;
      continue;
    }

    // Transcribe. A non-zero Whisper exit skips this question only (Behaviour.12).
    let transcript;
    try {
      transcript = runWhisper(audioPath);
    } catch (error) {
      if (error instanceof WhisperError) {
        console.error(`✗ Skipping question ${q.sequence}: ${error.message}`);
        skipped += 1;
        continue;
      }
      throw error;
    }

    // Copy the source MP3 into the media store (idempotent: skip if already there).
    const audioDest = resolve(getMediaDir(), relAudioPath);
    if (!existsSync(audioDest)) copyFileSync(audioPath, audioDest);

    await db.transaction(async (tx) => {
      const [questionRow] = await tx
        .insert(questions)
        .values({
          passageId: null,
          sourceFile: pdfPath,
          sequence: q.sequence,
          text: q.text || `Question ${q.sequence}`,
          section: 'listening',
        })
        .returning({ id: questions.id });

      await tx.insert(options).values(
        q.options.map((o) => ({
          questionId: questionRow.id,
          label: o.label,
          text: o.text,
          isCorrect: o.label === resolved.label,
        })),
      );

      await tx.insert(audioFiles).values({
        questionId: questionRow.id,
        filePath: relAudioPath,
        durationMs: transcript.durationMs,
      });

      if (transcript.segments.length > 0) {
        await tx.insert(transcriptSegments).values(
          transcript.segments.map((s) => ({
            questionId: questionRow.id,
            sequence: s.sequence,
            text: s.text,
            startMs: s.startMs,
            endMs: s.endMs,
          })),
        );
      }
    });

    questionsImported += 1;
    segmentsImported += transcript.segments.length;
  }

  console.log(
    `\nImport complete: ${questionsImported} listening questions imported, ` +
      `${segmentsImported} transcript segments stored, ${skipped} skipped. ` +
      `Score cross-check ${check.matches ? 'matched' : 'MISMATCHED'} ` +
      `(${check.pdfCorrect} correct / ${check.pdfPoints} of ${parsed.scoreSummary.maxPoints} pts).`,
  );
  client.close();
}

main().catch((error: unknown) => {
  console.error('Import failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
