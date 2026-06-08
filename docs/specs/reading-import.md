# Spec: Reading Question Import

## Status
draft

## Goal
Allow a developer to import reading comprehension questions from a source directory into the
local PostgreSQL database via a CLI script. The source directory contains exactly one **results
PDF** (the "Afficher les questions" review page exported from the Réussir TCF Canada site) and,
if the reading passages are not embedded in the PDF, one PNG image per passage. The PDF encodes
question order, question text, option text, and the **correct answer** (the green-highlighted
option). Once imported, questions are available for quiz sessions.

This replaces the earlier HTML-based approach. As with the listening section, the HTML export
omitted correct answers while the results PDF includes them via the green highlight, so the PDF
is the authoritative source for questions, options, and the answer key.

> **Note:** This spec mirrors the listening-import spec, which was validated against a real
> listening PDF. A real **reading** results PDF has not yet been inspected. The unknowns —
> chiefly whether passages are embedded as text in the PDF or supplied as separate images —
> are called out in Open questions and must be confirmed against a sample before implementation.

## Scope
- In scope:
  - CLI script `npm run ocr -- --dir <path>`
  - Directory discovery: locate the single PDF file and any passage PNG files in the directory
  - PDF parsing: per-question text, options A–D, and correct answer (the green-highlighted option)
  - Score-summary parsing for an integrity cross-check (see Behaviour.9)
  - Passage text acquisition: from the PDF if embedded, otherwise OCR of passage PNGs via
    Tesseract (see Open questions)
  - Positional passage matching when images are used: question at position N → `q<NN>.png`
  - Persisting passages + questions + options (with correct answer) to DB
  - Idempotent import: re-running with the same directory does not create duplicates
  - Error reporting for unreadable images, malformed PDF, or ambiguous answer highlighting
- Out of scope:
  - In-app import UI (CLI only for now)
  - Automatic LLM explanation generation (separate script, Milestone 6)
  - Editing or deleting imported questions via CLI

## PDF structure (Réussir TCF Canada results export)

The reading PDF is assumed to follow the same results-page layout as the listening PDF
(documented in listening-import.md §PDF structure). In summary:

```
Score summary (top):  "<C> de 39 réponses correctes…", "Votre temps: HH:MM:SS",
                      "You have reached <P> of 699 point(s), (<pct>%)"
Per question 1..39:   "<N>. Question", question text, options A–D (label + text),
                      result label "Correcte"/"Incorrecte" (attempt-specific; NOT stored)
```

**Answer detection** is identical to listening: the option on a **green** fill rectangle is the
correct answer (`is_correct = true`); a **red** fill is the original test-taker's wrong pick and
is ignored; no fill means a non-selected, non-correct option. Detection is a stable RGB match on
vector fill rectangles, not OCR. See listening-import.md §PDF structure for the recommended
parser approach (`pdfplumber` text + rect fill colours).

## Behaviour
1. The user runs the import script with a path to a source directory.
2. The script scans the directory, locates the single PDF file (and any PNG files); it exits
   with an error if no PDF file is found or more than one PDF file is found.
3. The script parses the PDF score summary (correct count, total points, time) for later
   cross-checking.
4. The script parses each question block to extract: sequence number, question text, options
   A–D (label + text), and the correct answer (the green-highlighted option).
5. The script acquires each question's passage text: from the PDF if passages are embedded,
   otherwise by running Tesseract OCR on the positionally matched `q<NN>.png` and storing the
   extracted text as a passage. (Which path applies is an Open question pending a real sample.)
6. Each question is inserted (section = 'reading') and linked to its passage; its options are
   persisted with `is_correct = true` for the green option and `false` for the other three.
7. After processing, the script recomputes the weighted score from the imported answer key
   (point map, quiz-session spec §Scoring) against the PDF's per-question Correcte/Incorrecte
   labels and compares it to the "<P> of 699" value. A mismatch is reported as a warning.
8. If a passage PNG is required but the matching file already exists in the DB (same path),
   the script prints a duplicate warning and skips that question without inserting new rows.
9. If Tesseract returns a non-zero exit code for a PNG, the script logs stderr and skips that
   question; remaining questions continue to be processed.
10. If a question has zero green options or more than one green option, the script logs a
    descriptive error identifying the question and skips it (the answer is indeterminate).
11. If the PDF cannot be parsed (no question blocks found, or the score summary is absent), the
    script logs a descriptive error and exits without writing anything to the DB.
12. On success, the script prints a summary: number of passages imported, number of questions
    imported, number skipped, and whether the recomputed score matched the PDF.

## Data model changes
```
passages
  id          serial primary key
  source_file text not null unique   -- passage PNG path, or the PDF path when passages are
                                      -- embedded in the PDF; used for duplicate detection
  text        text not null          -- passage content (from PDF text or OCR)
  created_at  timestamptz not null default now()

questions
  id           serial primary key
  passage_id   integer references passages(id)
  source_file  text not null          -- path to the results PDF
  sequence     integer not null       -- 1-based position within the PDF
  text         text not null
  section      text not null check (section in ('reading', 'listening'))
  created_at   timestamptz not null default now()
  UNIQUE (source_file, sequence)     -- idempotency key; composite because one PDF → many questions

options
  id          serial primary key
  question_id integer not null references questions(id)
  label       text not null check (label in ('A', 'B', 'C', 'D'))
  text        text not null
  is_correct  boolean not null       -- true for the green-highlighted option
```

## API contract
None — CLI script only.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above. (Criteria that depend
on the passage-embedding question are phrased to cover both the embedded-text and image+OCR paths.)

- [ ] Running `npm run ocr -- --dir <path>` on a directory holding exactly one PDF completes and prints a final summary line. (Behaviour.1, 12)
- [ ] The script exits non-zero with a descriptive error — and writes no rows — when the directory has no PDF or more than one PDF. (Behaviour.2)
- [ ] For a valid sample PDF, every imported question row has `section = 'reading'`, the sequence number from the PDF, `source_file` set to the PDF path, and a non-null `passage_id`. (Behaviour.4, 5, 6)
- [ ] For each imported question, exactly one option has `is_correct = true` and it matches the green-highlighted option in the PDF; the other three are `is_correct = false`. (Behaviour.4, 6)
- [ ] A question whose option set has zero or more than one green fill is skipped with a descriptive error naming that question, and the remaining questions still import. (Behaviour.10)
- [ ] Passage text is acquired from the PDF when embedded, otherwise via Tesseract OCR on the positionally matched `q<NN>.png`; a non-zero Tesseract exit skips that question with stderr logged and does not abort the run. (Behaviour.5, 9)
- [ ] Re-running the import on the same directory creates no duplicate rows — `UNIQUE(source_file, sequence)` and `passages.source_file` uniqueness both hold; a duplicate passage path prints a warning and the question is skipped. (Behaviour.8)
- [ ] The recomputed weighted score (point map vs. the PDF's per-question Correcte/Incorrecte labels) is compared to the parsed "<P> of 699" value, and a mismatch emits a warning. (Behaviour.3, 7)
- [ ] A PDF with no parseable question blocks or a missing score summary produces a descriptive error and leaves the DB unchanged. (Behaviour.11)
- [ ] The success summary reports passages imported, questions imported, questions skipped, and whether the score cross-check matched. (Behaviour.12)

## Open questions
- **Are reading passages embedded as text in the results PDF, or supplied as separate images?**
  This is the primary unknown and changes Behaviour.5 substantially. Needs a real reading PDF
  sample to confirm. If embedded, the Tesseract/OCR path and PNG files are unnecessary.
- **Passage-to-question cardinality.** TCF reading often groups several questions under one
  document. Does the PDF delimit passages, and how are questions associated with them? The
  current `passage_id` allows many questions per passage, but the parsing rule to detect
  passage boundaries is unknown without a sample.
- **Exact green/red RGB values** — same as listening; confirm against a sample.
- Whether the CLI verb should remain `ocr` if passages turn out to be embedded text (no OCR
  involved). May rename or keep for symmetry with `transcribe`.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-05: Changed CLI from per-file flags to `--dir`; one HTML + multiple PNGs per directory
- 2026-06-05: Updated open questions based on wpProQuiz HTML sample from listening section;
  flagged likely absence of correct answers in HTML
- 2026-06-05: Added `sequence` column to questions; changed `source_file` from `unique` to
  composite `UNIQUE(source_file, sequence)` to support one HTML → many questions; updated
  Behaviour.3 and Behaviour.6 to make correct-answer extraction conditional
- 2026-06-07: Switched source from HTML to the results PDF, mirroring listening-import. Correct
  answers are now extracted from the green-highlighted option. Added score cross-check and
  indeterminate-answer handling. Flagged passage embedding vs. image+OCR as the key open
  question pending a real reading PDF sample.
- 2026-06-08: Added Acceptance criteria section (testable pass/fail conditions derived from Behaviour).
