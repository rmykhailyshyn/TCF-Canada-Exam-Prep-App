# Spec: Listening Question Import

## Status
draft

## Goal
Allow a developer to import listening comprehension questions from a source directory into the
local PostgreSQL database via a CLI script. The source directory contains exactly one **results
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
  - Automatic LLM explanation generation (Milestone 6)
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
colours are vector fill rectangles (a CSS background), not scanned pixels, so detection is a
stable RGB match within a small tolerance — not fuzzy OCR.

Recommended parser: a library that exposes both text bounding boxes and rectangle fill colours
(e.g. Python `pdfplumber`'s `words` + `rects[].non_stroking_color`; Python is already in the
toolchain via `mlx-whisper`). For each option, the importer finds the fill rectangle whose
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

## Open questions
- Which Whisper CLI variant takes priority: `mlx-whisper` or `whisper.cpp`? Should the
  script auto-detect or read from an env var (`WHISPER_CMD`)?
- Does Whisper output segments as JSON directly, or does the script need to parse a text
  format? Confirm the `--output_format json` flag is available in both CLI variants.
- **Exact green/red RGB values.** Need to sample the PDF's success/danger fill colours and
  set a tolerance. Confirm they are consistent across exports (they should be — fixed CSS).
- **Media naming convention.** This spec assumes `q<NN>.mp3`. If exported MP3s use the site's
  native names (e.g. `20Q7.mp3`), the importer must either rename on ingest or match the Nth
  sorted file to question N. Confirm the naming the user will actually provide.
- **Image-bearing questions** (Q1–6 in the sample: "choisissez celle qui correspond à
  l'image"). The PDF embeds an image and the options are audio-only (empty text). How should
  the image be stored and shown in the quiz UI? Out of scope for this iteration; flagged for
  a follow-up spec.
- Should a score-cross-check mismatch (Behaviour.10) be a hard failure (abort, no writes) or
  a non-fatal warning? Currently specced as a warning.

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
