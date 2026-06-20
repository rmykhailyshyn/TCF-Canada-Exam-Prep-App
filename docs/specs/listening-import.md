# Spec: Listening Question Import

## Status
implemented

## Goal
Allow a developer to import listening comprehension questions from a source directory into the
local database via a CLI script. The source directory contains exactly one **results
PDF** (the "Afficher les questions" review page exported from the Réussir TCF Canada site after
completing a quiz) and one local MP3 audio file per question. The PDF encodes question order,
question text, option text, and — critically — the **correct answer**, which is the option
highlighted with a green background fill. Whisper transcription is run on each audio file to
produce phrase-level segments with timestamps, stored alongside the audio path to power subtitle
display.

This replaces the earlier HTML-based approach. The HTML (wpProQuiz) export omitted the correct
answers; the results PDF includes them, so the PDF is the authoritative source for questions,
options, and the answer key. Media files are matched to questions by position, not by URL.

## Scope
- In scope:
  - CLI script `npm run transcribe -- --dir <path>`
  - Directory discovery: locate the single PDF file and all MP3 files (up to 39) in the directory
  - PDF parsing: per-question text, options A–D (text where present), and correct answer
    (the green-highlighted option)
  - Score-summary parsing for an integrity cross-check (see Behaviour.10)
  - Positional MP3 matching: question at position N → `q<NN>.mp3` (zero-padded, 1-based)
  - Whisper transcription of each MP3 via `mlx-whisper` or `whisper.cpp` CLI (Apple Silicon only)
  - Phrase-level transcript segments with start/end timestamps extracted from Whisper output
  - Persisting audio paths, transcript segments, questions, and options (with correct answer) to DB
  - Idempotent import: re-running with the same directory skips already-imported questions
  - Error reporting for failed transcription, malformed PDF, or ambiguous answer highlighting
- Out of scope:
  - HTML parsing (removed — superseded by PDF parsing)
  - In-app import UI
  - Word-level timestamp granularity
  - Automatic LLM explanation generation (Milestone 7)
  - Image-bearing listening questions (e.g. "choisissez celle qui correspond à l'image") —
    their associated image is not imported yet; see Open questions

## PDF structure (Réussir TCF Canada results export)

The PDF is the post-quiz review page. Relevant content:

```
Score summary (top of document):
  "<C> de 39 réponses correctes aux questions"   → correct count
  "Votre temps: HH:MM:SS"                          → time taken (informational)
  "You have reached <P> of 699 point(s), (<pct>%)" → weighted score (used for cross-check)

Per question (repeated 1..39):
  "<N>. Question"                  → question number / sequence
  <instruction/question text>      → e.g. "Écoutez le document sonore et la question…"
  Option rows A–D                  → label (A|B|C|D) + option text (may be empty for
                                     audio-only questions where options are spoken)
  Result label                     → "Correcte" | "Incorrecte" (attempt-specific; NOT stored)
```

**Answer detection (the key mechanism).** Each option row may sit on a coloured background
rectangle:
- **Green fill → the correct answer.** This holds whether or not the original test-taker
  answered correctly: on a correct attempt their (correct) pick is green; on an incorrect
  attempt the correct option is still green and their wrong pick is red.
- **Red fill → the original test-taker's incorrect pick.** Ignored by the importer.
- **No fill → a non-selected, non-correct option.**

The importer reads the **green** option as `is_correct = true` and ignores red entirely. The
colours are vector fills (a CSS background), not scanned pixels, so detection is a stable RGB
match within a small tolerance — not fuzzy OCR.

**Validated against a real results PDF (2026-06-08).** The colour-coded option backgrounds are
rounded rectangles, which print-to-PDF emits as bezier **`curves`, not `rects`** — `page.rects`
contains no green fills. The parser must inspect `page.curves` (`non_stroking_color`). Confirmed
fill colours (RGB 0–1, ±0.06 tolerance): correct/green `(0.0, 0.737, 0.271)`; wrong-pick/red
`(0.839, 0.114, 0.114)` (also a darker `(0.886, 0.051, 0.051)`); default-row/grey
`(0.941, 0.953, 0.965)`. Each question contributes four answer-row curves (`x0 ≈ 898`, w ≈ 746,
h ≈ 58); one rounded rect is drawn as several overlapping curves, so de-duplicate by
`(page, top, x0)`. Option rows carry a leading icon glyph extracted as the literal token `88`
between the A–D label and the text (e.g. `A 88 D'aller…`); strip it. Audio-only/image questions
(e.g. Q1–6) have empty text after `88`.

Recommended parser: a library that exposes both text bounding boxes and vector fill colours
(e.g. Python `pdfplumber`'s `extract_words()` + `curves[].non_stroking_color`; Python is already
in the toolchain via `mlx-whisper`). For each option, the importer finds the fill curve whose
bounding box contains the option-row text and classifies it by colour.

The list of timestamp pairs near the bottom of each page (e.g. `00:21 00:22`) is the original
audio play range per question; it is ignored — transcript timing comes from Whisper.

## Behaviour
1. The user runs the import script with a path to a source directory.
2. The script scans the directory, locates the single PDF file and all MP3 files; it exits
   with an error if no PDF file is found, more than one PDF file is found, or no MP3 files
   are found.
3. The script parses the PDF score summary (correct count, total points, time) for later
   cross-checking.
4. The script parses each question block to extract: sequence number, question/instruction
   text, options A–D (label + text), and the correct answer (the green-highlighted option).
5. For each question the script resolves its local MP3 by position: question at sequence `N`
   matches the file named `q<NN>.mp3` (zero-padded two digits, e.g. question 7 → `q07.mp3`).
6. If no MP3 matches a question's expected filename, the script logs a warning for that
   question and skips it; remaining questions continue to be processed.
7. For each matched MP3, the script runs Whisper and captures phrase-level segments
   (text, start_ms, end_ms).
8. A question row is inserted (section = 'listening'); its options are persisted with
   `is_correct = true` for the green option and `false` for the other three.
9. Audio metadata (file path) and transcript segments are persisted linked to the question.
10. After processing, the script recomputes the weighted score from the imported answer key
    using the point map (quiz-session spec §Scoring) against the PDF's per-question
    Correcte/Incorrecte labels, and compares it to the "<P> of 699" value parsed in step 3.
    A mismatch is reported as a warning (it indicates a colour-detection or parsing fault).
11. If an MP3 with the same file path already exists in the DB, the script prints a duplicate
    warning for that file and skips it (and its linked question) without inserting new rows.
12. If Whisper returns a non-zero exit code for an MP3, the script logs stderr and skips
    that MP3 and its linked question; remaining MP3s continue to be processed.
13. If a question has zero green options or more than one green option, the script logs a
    descriptive error identifying the question and skips it (the answer is indeterminate).
14. If the PDF cannot be parsed (no question blocks found, or the score summary is absent),
    the script logs a descriptive error and exits without writing anything to the DB.
15. On success, the script prints a summary: number of questions imported, total transcript
    segments stored, number of questions skipped (no matching MP3 / indeterminate answer),
    and whether the recomputed score matched the PDF.

## Data model changes
```
-- questions table already defined in reading-import spec.
-- section = 'listening'; passage_id is null; sequence = question number from the PDF;
-- source_file = path to the PDF file; UNIQUE(source_file, sequence) enforces idempotency.
-- Correct answers are now populated at import time (no separate answer-key step needed).

audio_files
  id           serial primary key
  question_id  integer not null unique references questions(id)
  file_path    text not null unique    -- absolute or repo-relative path to MP3
  duration_ms  integer                 -- optional, populated if Whisper reports it

transcript_segments
  id          serial primary key
  question_id integer not null references questions(id)
  sequence    integer not null         -- 1-based ordering
  text        text not null
  start_ms    integer not null
  end_ms      integer not null
```

## API contract
None — CLI script only.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] Running `npm run transcribe -- --dir <path>` on a directory holding exactly one PDF and at least one MP3 completes and prints a final summary line. (Behaviour.1, 15)
- [ ] The script exits non-zero with a descriptive error — and writes no rows — when the directory has no PDF, more than one PDF, or zero MP3 files. (Behaviour.2)
- [ ] For a valid sample PDF, every imported question row has `section = 'listening'`, the sequence number from the PDF, and `source_file` set to the PDF path. (Behaviour.4, 8)
- [ ] For each imported question, exactly one option has `is_correct = true` and it matches the green-highlighted option in the PDF; the other three are `is_correct = false`. (Behaviour.4, 8)
- [ ] A question whose option set has zero or more than one green fill is skipped with a descriptive error naming that question, and the remaining questions still import. (Behaviour.13)
- [ ] Each imported question with a matching `q<NN>.mp3` has one `audio_files` row (with `file_path`) and at least one `transcript_segments` row; segments are ordered by `sequence` and every row satisfies `start_ms <= end_ms`. (Behaviour.5, 7, 9)
- [ ] A question with no matching MP3 file is skipped with a warning while other questions continue to import. (Behaviour.6)
- [ ] An MP3 whose Whisper invocation exits non-zero is skipped with its stderr logged, without aborting the run. (Behaviour.12)
- [ ] Re-running the import on the same directory adds no new rows and prints a duplicate warning for each already-imported file — `UNIQUE(source_file, sequence)` and `audio_files.file_path` uniqueness both hold. (Behaviour.11)
- [ ] The recomputed weighted score (point map vs. the PDF's per-question Correcte/Incorrecte labels) is compared to the parsed "<P> of 699" value, and a mismatch emits a warning. (Behaviour.3, 10)
- [ ] A PDF with no parseable question blocks or a missing score summary produces a descriptive error and leaves the DB unchanged. (Behaviour.14)
- [ ] The success summary reports the number of questions imported, transcript segments stored, questions skipped, and whether the score cross-check matched. (Behaviour.15)

## Open questions
- ~~Which Whisper CLI variant takes priority: `mlx-whisper` or `whisper.cpp`? Should the
  script auto-detect or read from an env var (`WHISPER_CMD`)?~~ Resolved 2026-06-09 at
  implementation: the importer targets **`mlx_whisper`** (the Apple-Silicon, pip-installable
  variant, aligned with the existing Python toolchain), invoked via `runWhisper` in
  `scripts/lib/whisper.ts`. The binary is overridable with **`WHISPER_CMD`** and the model with
  `WHISPER_MODEL` (default `mlx-community/whisper-large-v3-turbo`) — mirroring the `TESSERACT_BIN`
  / `PYTHON_BIN` pattern. `whisper.cpp` is not wired up; substituting a CLI that emits the same
  `--output-format json` shape via `WHISPER_CMD` would work, otherwise it needs its own wrapper.
- ~~Does Whisper output segments as JSON directly, or does the script need to parse a text
  format? Confirm the `--output_format json` flag is available in both CLI variants.~~ Resolved:
  `mlx_whisper --output-format json --output-dir <dir>` writes `<name>.json` with a `segments`
  array of `{ start, end, text }` (timestamps in **seconds**). `parseWhisperJson` converts these
  to ordered ms segments (dropping blanks, clamping `end ≥ start`) and reports the clip duration
  as the last segment's end.
- ~~**Exact green/red RGB values.** Need to sample the PDF's success/danger fill colours and
  set a tolerance.~~ Resolved 2026-06-08 against a real PDF (see §PDF structure). Green
  `(0.0, 0.737, 0.271)`, red `(0.839, 0.114, 0.114)`, grey `(0.941, 0.953, 0.965)`, ±0.06
  tolerance; fills are `curves`, not `rects`.
- ~~**Media naming convention.** This spec assumes `q<NN>.mp3`. If exported MP3s use the site's
  native names (e.g. `20Q7.mp3`), the importer must either rename on ingest or match the Nth
  sorted file to question N.~~ Resolved 2026-06-09: matching reuses
  `extractSequenceFromFilename`, which reads the digits after a `Q` (or the last number in the
  name). That handles **both** `q07.mp3` and the native `20Q7.mp3` form with no rename step, so
  the importer accepts either convention.
- **Image-bearing questions** (Q1–6 in the sample: "choisissez celle qui correspond à
  l'image"). The PDF embeds an image and the options are audio-only (empty text). How should
  the image be stored and shown in the quiz UI? Out of scope for this iteration; flagged for
  a follow-up spec. (Still open — these questions import with empty option text and no image.)
- ~~Should a score-cross-check mismatch (Behaviour.10) be a hard failure (abort, no writes) or
  a non-fatal warning?~~ Resolved: a **non-fatal warning**, matching the reading importer.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-05: Changed CLI from per-file flags to `--dir`; one HTML + multiple MP3s per directory
- 2026-06-05: Documented wpProQuiz HTML parsing structure; resolved MP3 matching (filename
  from audio src URL); flagged that correct answers are absent from this HTML format
- 2026-06-05: Updated data model note to reference `sequence` column and composite unique key
- 2026-06-07: Switched source from HTML to the results PDF. Correct answers are now extracted
  from the green-highlighted option (resolves the long-standing answer-key gap). MP3s matched
  positionally instead of by audio src URL. Added score cross-check (Behaviour.10) and
  indeterminate-answer handling (Behaviour.13). `source_file` now refers to the PDF path.
- 2026-06-08: Added Acceptance criteria section (testable pass/fail conditions derived from Behaviour).
- 2026-06-08: Status moved draft → approved.
- 2026-06-08: **Spec defect fix (SDD Rule 4).** During Milestone 2 a real results PDF was
  inspected (the shared PDF parser is used by both reading and listening import). Answer-row
  backgrounds are vector `curves` (rounded rects), not `rects`; resolved the exact green/red/grey
  RGB values (open question); documented the `88` icon-glyph artifact and the four-curves-per-
  question de-duplication. Confirmed by reproducing the PDF's "27/39 correct" and "437/699
  points" cross-check. Whisper-related open questions are unaffected and remain open.
- 2026-06-09: Implemented (Milestone 3). Added `scripts/lib/whisper.ts` (`runWhisper` +
  pure `parseWhisperJson`) and the `scripts/transcribe.ts` orchestrator (`npm run transcribe`).
  Resolved the Whisper-variant, JSON-format, media-naming, and score-mismatch open questions
  (see §Open questions). Image-bearing questions (Q1–6) remain out of scope. Status
  approved → implemented.
- 2026-06-20: Made the Goal dialect-agnostic ("local PostgreSQL database" → "local database") ahead of
  the PostgreSQL → SQLite migration (`docs/specs/database-sqlite.md`, Milestone 13). Import behaviour is
  unchanged — all DB access is via Drizzle. (Whisper transcription remains Apple-Silicon/macOS-only and
  local-only; it is never run in the Cloudflare deployment.)
