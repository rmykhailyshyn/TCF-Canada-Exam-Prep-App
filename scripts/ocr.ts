import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../server/db';
import { options, passages, questions } from '../server/db/schema';
import { getMediaDir } from '../server/config/env';
import { runPdfParser } from './lib/parse';
import {
  crossCheckScore,
  extractSequenceFromFilename,
  hasImageMagic,
  resolveCorrectLabel,
  splitStimulus,
} from './lib/results';
import { TesseractError, runTesseract } from './lib/tesseract';

// Reads the first bytes of a file to sniff its real type (cheap; avoids loading whole images).
function readMagic(path: string): Uint8Array {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(8);
    readSync(fd, buf, 0, 8, 0);
    return buf;
  } finally {
    closeSync(fd);
  }
}

// spec: docs/specs/reading-import.md
// Reading import CLI: `npm run ocr -- --dir <path>`. The folder holds the single results PDF and
// one passage image per question (filename contains the question's sequence number). The PDF
// yields options + answer key (green fill) + score; each image is OCR'd into passage + question
// text. Apple Silicon / macOS only for the OCR step (CLAUDE.md). Shell calls go through
// scripts/lib wrappers; DB access stays in Drizzle.

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'];

function parseDirArg(argv: string[]): string {
  const idx = argv.indexOf('--dir');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith('--dir='));
  if (eq) return eq.slice('--dir='.length);
  throw new Error('Usage: npm run ocr -- --dir <path>');
}

// spec: docs/specs/reading-import.md §Behaviour.2 — exactly one PDF must be present.
function findSinglePdf(dir: string, entries: string[]): string {
  const pdfs = entries.filter((f) => f.toLowerCase().endsWith('.pdf'));
  if (pdfs.length === 0) throw new Error(`No PDF file found in ${dir}`);
  if (pdfs.length > 1) {
    throw new Error(`Expected exactly one PDF in ${dir}, found ${pdfs.length}: ${pdfs.join(', ')}`);
  }
  return resolve(dir, pdfs[0]);
}

// spec: docs/specs/reading-import.md §Behaviour.5 — map sequence → passage image by filename.
function mapImagesBySequence(dir: string, entries: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const entry of entries) {
    const lower = entry.toLowerCase();
    if (!IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue;
    const seq = extractSequenceFromFilename(entry);
    if (seq == null) {
      console.warn(`• Ignoring image with no sequence number in its name: ${entry}`);
      continue;
    }
    if (map.has(seq)) {
      console.warn(`• Multiple images map to question ${seq}; using ${map.get(seq)}, ignoring ${entry}`);
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
  const imagesBySequence = mapImagesBySequence(dir, entries);

  // Parse + validate before any DB writes (Behaviour.11: a bad PDF leaves the DB untouched).
  const parsed = runPdfParser(pdfPath);

  // Score cross-check (Behaviour.7) — a warning, not a hard failure.
  const check = crossCheckScore(parsed);
  if (!check.matches) {
    console.warn(
      `⚠ Score cross-check mismatch: recomputed ${check.recomputedCorrect} correct / ` +
        `${check.recomputedPoints} pts vs PDF ${check.pdfCorrect} / ${check.pdfPoints}. ` +
        `This usually means a colour-detection or parsing fault.`,
    );
  }

  let passagesImported = 0;
  let questionsImported = 0;
  let skipped = 0;

  mkdirSync(resolve(getMediaDir(), 'reading'), { recursive: true });

  for (const q of parsed.questions) {
    // Answer key: exactly one green option (Behaviour.10).
    const resolved = resolveCorrectLabel(q);
    if (!resolved.ok) {
      console.error(`✗ Skipping question ${q.sequence}: ${resolved.reason}`);
      skipped += 1;
      continue;
    }

    // Idempotency: skip a question already imported from this PDF (UNIQUE source_file+sequence).
    const existingQuestion = await db
      .select({ id: questions.id })
      .from(questions)
      .where(and(eq(questions.sourceFile, pdfPath), eq(questions.sequence, q.sequence)));
    if (existingQuestion.length > 0) {
      console.warn(`• Question ${q.sequence} already imported — skipping.`);
      skipped += 1;
      continue;
    }

    // Passage image, matched by the sequence number in its filename (Behaviour.5).
    const imagePath = imagesBySequence.get(q.sequence);
    if (!imagePath) {
      console.warn(`• Question ${q.sequence}: no passage image found in the folder — skipping.`);
      skipped += 1;
      continue;
    }

    // The image is copied into MEDIA_DIR/reading/ and the DB stores the path RELATIVE to MEDIA_DIR,
    // so the data is portable (the source --dir can move/disappear). spec: docs/specs/reading-import.md
    const relImagePath = join('reading', basename(imagePath));

    // Duplicate passage path → skip without inserting (Behaviour.8).
    const existingPassage = await db
      .select({ id: passages.id })
      .from(passages)
      .where(eq(passages.sourceFile, relImagePath));
    if (existingPassage.length > 0) {
      console.warn(`• Passage for question ${q.sequence} already imported — skipping.`);
      skipped += 1;
      continue;
    }

    // Guard against files that carry an image extension but aren't images (e.g. an HTML page
    // saved as `.png` — a real export hazard). Gives a clear message instead of a cryptic
    // Tesseract/leptonica error.
    if (!hasImageMagic(readMagic(imagePath))) {
      console.error(
        `✗ Skipping question ${q.sequence}: ${basename(imagePath)} is not a PNG/JPEG image ` +
          `(its content is not image data — likely an HTML page saved with an image extension). ` +
          `Re-export the passage images as real PNG/JPEG files.`,
      );
      skipped += 1;
      continue;
    }

    // OCR the image and split it into passage + question (Behaviour.5). A non-zero Tesseract
    // exit skips this question only (Behaviour.9).
    let passageText: string;
    let questionText: string;
    try {
      const ocr = runTesseract(imagePath);
      const split = splitStimulus(ocr);
      passageText = split.passage;
      questionText = split.question || q.text || `Question ${q.sequence}`;
    } catch (error) {
      if (error instanceof TesseractError) {
        console.error(`✗ Skipping question ${q.sequence}: ${error.message}`);
        skipped += 1;
        continue;
      }
      throw error;
    }

    // Copy the source image into the media store (idempotent: skip if already there).
    const imageDest = resolve(getMediaDir(), relImagePath);
    if (!existsSync(imageDest)) copyFileSync(imagePath, imageDest);

    await db.transaction(async (tx) => {
      const [passageRow] = await tx
        .insert(passages)
        .values({ sourceFile: relImagePath, text: passageText })
        .returning({ id: passages.id });

      const [questionRow] = await tx
        .insert(questions)
        .values({
          passageId: passageRow.id,
          sourceFile: pdfPath,
          sequence: q.sequence,
          text: questionText,
          section: 'reading',
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
    });

    passagesImported += 1;
    questionsImported += 1;
  }

  console.log(
    `\nImport complete: ${passagesImported} passages, ${questionsImported} questions imported, ` +
      `${skipped} skipped. Score cross-check ${check.matches ? 'matched' : 'MISMATCHED'} ` +
      `(${check.pdfCorrect} correct / ${check.pdfPoints} of ${parsed.scoreSummary.maxPoints} pts).`,
  );
  client.close();
}

main().catch((error: unknown) => {
  console.error('Import failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
