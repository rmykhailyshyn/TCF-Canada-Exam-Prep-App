# Spec: Reading Question Import

## Status
implemented

## Goal
Allow a developer to import reading comprehension questions from a source directory into the
local PostgreSQL database via a CLI script. The source directory contains exactly one **results
PDF** (the "Afficher les questions" review page exported from the Réussir TCF Canada site) and
**one passage image per question** (a PNG whose filename contains the question's sequence number).
The PDF encodes question order, the option text, and the **correct answer** (the green-highlighted
option). Each passage image contains the reading document **and** the question prompt; these are
obtained by OCR. Once imported, questions are available for quiz sessions.

This replaces the earlier HTML-based approach. As with the listening section, the HTML export
omitted correct answers while the results PDF includes them via the green highlight, so the PDF
is the authoritative source for options and the answer key; the passage images are the source for
the passage text and the question prompt.

> **Resolved against a real reading PDF + image (2026-06-08).** The earlier open question —
> whether passages are embedded as PDF text or supplied as images — is settled: each question's
> stimulus (passage + prompt) is a **separate image**, OCR'd at import. The reading PDF also
> carries an inconsistent hidden text layer for some passages, but it is not authoritative and is
> not used. See §PDF structure and Revision history.

## Scope
- In scope:
  - CLI script `npm run ocr -- --dir <path>`
  - Directory discovery: locate the single PDF file and all passage image files in the directory
  - PDF parsing: per-question options A–D and the correct answer (the green-highlighted option)
  - Score-summary parsing for an integrity cross-check (see Behaviour.9)
  - Passage + question-prompt acquisition: Tesseract OCR of the per-question image, split into
    the passage and the question prompt at the `www.reussir-tcfcanada.com` footer line
  - Passage-image matching by the **sequence number embedded in the filename** (e.g.
    `comprehension-ecrite-25Q39.png` → question 39); the number after `Q`, else the last number
  - Persisting passages + questions + options (with correct answer) to DB
  - Idempotent import: re-running with the same directory does not create duplicates
  - Error reporting for unreadable images, malformed PDF, or ambiguous answer highlighting
- Out of scope:
  - In-app import UI (CLI only for now)
  - Automatic LLM explanation generation (separate script, Milestone 6)
  - Editing or deleting imported questions via CLI

## PDF structure (Réussir TCF Canada results export)

The reading PDF shares the score summary and the green/red answer mechanism with listening, but
its per-question layout **differs**: there is **no `"N. Question"` header and no question text in
the PDF text layer**. Each question is a per-question image (the passage document + the prompt)
followed by the four option rows and the result label. The question text is not extractable from
the PDF — it lives in the image and is OCR'd.

```
Score summary (top):  "<C> de 39 réponses correctes…", "Votre temps: HH:MM:SS",
                      "You have reached <P> of 699 point(s), (<pct>%)"
Per question 1..39:   [passage+prompt image]  options A–D ("<A-D> 88 <text>")  "Correcte"/"Incorrecte"
```

Because there is no header, questions are delimited by their **option block + result label** and
the **sequence is the 1-based document order**. The option-row curves sit at `x0 ≈ 844` (vs.
`≈ 898` for listening), so the parser accepts a wide `x0` band. Each passage image, OCR'd, has the
shape: passage lines · `www.reussir-tcfcanada.com` footer · badge number + question prompt — so
the importer splits on the footer and strips the leading badge number from the prompt.

**Answer detection** is identical to listening: the option on a **green** fill is the correct
answer (`is_correct = true`); a **red** fill is the original test-taker's wrong pick and is
ignored; the default light-grey fill means a non-selected, non-correct option. Detection is a
stable RGB match on vector fills, not OCR. See listening-import.md §PDF structure for the
recommended parser approach (`pdfplumber`).

**Validated against a real results PDF (2026-06-08).** The colour-coded option backgrounds are
rounded rectangles, which the site's print-to-PDF emits as **bezier `curves`, not `rects`** —
reading them from `page.rects` finds nothing. The parser must inspect `page.curves`
(`non_stroking_color`) for the answer-row fills. Confirmed fill colours (RGB 0–1, match within
±0.06 tolerance):

| Meaning | RGB | approx hex |
|---|---|---|
| Correct answer (green) | `(0.0, 0.737, 0.271)` | `#00BC45` |
| Test-taker's wrong pick (red, ignored) | `(0.839, 0.114, 0.114)` (also a darker `(0.886, 0.051, 0.051)`) | `#D61D1D` |
| Default option row (grey) | `(0.941, 0.953, 0.965)` | `#F0F3F6` |

Each question contributes four answer-row curves (`x0 ≈ 844` reading / `≈ 898` listening, width
≈ 746, height ≈ 58); a single rounded rect is drawn as several overlapping curves, so de-duplicate
by `(page, top, x0)`. Option rows carry a leading icon glyph that `pdfplumber` extracts as the
literal token `88` between the A–D label and the option text (e.g. `A 88 Pour préparer son
voyage.`); the mandatory `88` is required by the option regex, which both strips it and prevents
passage text starting with A–D from matching. (In listening, audio-only questions have empty text
after `88`.)

## Behaviour
1. The user runs the import script with a path to a source directory.
2. The script scans the directory, locates the single PDF file (and any PNG files); it exits
   with an error if no PDF file is found or more than one PDF file is found.
3. The script parses the PDF score summary (correct count, total points, time) for later
   cross-checking.
4. The script parses each question block to extract: sequence number (1-based document order),
   options A–D (label + text), and the correct answer (the green-highlighted option). The
   question prompt is not in the PDF (see Behaviour.5).
5. The script acquires each question's passage and question prompt by running Tesseract OCR on the
   passage image whose filename contains that question's sequence number, then splitting the OCR
   text at the `www.reussir-tcfcanada.com` footer: text before the footer is the passage, text
   after it (minus the leading badge number) is the question prompt.
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
  source_file text not null unique   -- passage image path; used for duplicate detection.
                                      -- One image per question, so passage:question is 1:1 here.
  text        text not null          -- passage content (OCR of the image, before the footer)
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
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] Running `npm run ocr -- --dir <path>` on a directory holding exactly one PDF completes and prints a final summary line. (Behaviour.1, 12)
- [ ] The script exits non-zero with a descriptive error — and writes no rows — when the directory has no PDF or more than one PDF. (Behaviour.2)
- [ ] For a valid sample PDF, every imported question row has `section = 'reading'`, the sequence number from the PDF, `source_file` set to the PDF path, and a non-null `passage_id`. (Behaviour.4, 5, 6)
- [ ] For each imported question, exactly one option has `is_correct = true` and it matches the green-highlighted option in the PDF; the other three are `is_correct = false`. (Behaviour.4, 6)
- [ ] A question whose option set has zero or more than one green fill is skipped with a descriptive error naming that question, and the remaining questions still import. (Behaviour.10)
- [ ] Passage text and question prompt are acquired via Tesseract OCR of the passage image matched by the filename's sequence number, split at the footer; a non-zero Tesseract exit skips that question with stderr logged and does not abort the run. (Behaviour.5, 9)
- [ ] Re-running the import on the same directory creates no duplicate rows — `UNIQUE(source_file, sequence)` and `passages.source_file` uniqueness both hold; a duplicate passage path prints a warning and the question is skipped. (Behaviour.8)
- [ ] The recomputed weighted score (point map vs. the PDF's per-question Correcte/Incorrecte labels) is compared to the parsed "<P> of 699" value, and a mismatch emits a warning. (Behaviour.3, 7)
- [ ] A PDF with no parseable question blocks or a missing score summary produces a descriptive error and leaves the DB unchanged. (Behaviour.11)
- [ ] The success summary reports passages imported, questions imported, questions skipped, and whether the score cross-check matched. (Behaviour.12)

## Open questions
- ~~**Are reading passages embedded as text in the results PDF, or supplied as separate images?**~~
  Resolved 2026-06-08 against a real reading PDF + image: each question's stimulus (passage +
  prompt) is a **separate image**, OCR'd at import. The PDF text layer holds only options + answer
  key + score; the question prompt is not in it.
- ~~**Passage-to-question cardinality.**~~ Resolved: one image per question (passage + prompt
  together), so passage:question is **1:1** in this format. The `passage_id` column still allows
  many-to-one for future formats.
- ~~**Exact green/red RGB values** — same as listening; confirm against a sample.~~
  Resolved 2026-06-08 against a real PDF (see §PDF structure table). Green `(0.0, 0.737, 0.271)`,
  red `(0.839, 0.114, 0.114)`, grey `(0.941, 0.953, 0.965)`; fills are `curves`, not `rects`.
- ~~Whether the CLI verb should remain `ocr`~~ — kept as `ocr`: OCR is genuinely used (the passage
  images are OCR'd), so the verb is accurate.
- **OCR quality.** Tesseract output has minor artifacts (drop-cap letters, accents, "L" → "| e").
  Acceptable for self-study; a future LLM-enrichment or cleanup pass (Milestone 6) could normalise
  the text. The passage/prompt split relies on the `reussir-tcfcanada.com` footer being present in
  every image — confirmed across the sample, but a missing footer falls back to "last line = prompt".

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
- 2026-06-08: Status moved draft → approved.
- 2026-06-08: **Spec defect fix (SDD Rule 4).** Validated the answer-detection mechanism against a
  real results PDF during Milestone 2 implementation. Correct answer-row backgrounds are vector
  `curves` (rounded rects), not `rects` as previously stated — reading `page.rects` finds zero
  green fills. Resolved the exact green/red/grey RGB values (open question), documented the `88`
  icon-glyph artifact in option text, and the four-curves-per-question de-duplication rule. The
  parser was confirmed by reproducing the PDF's "27/39 correct" and "437/699 points" via the
  score cross-check (Behaviour.7). Mechanism still **unvalidated for reading passages** — the
  sample inspected was a listening PDF (no passages); the passage-embedding open question remains.
- 2026-06-08: Implemented in Milestone 2. Pipeline: `scripts/parse_results_pdf.py` (pdfplumber)
  → `scripts/ocr.ts` (Drizzle persistence) via `npm run ocr -- --dir <path>`. Validated against
  a real results PDF (directory rule, parsing, answer key, score cross-check) and a full OCR
  insert against a synthesized passage image (passage + question + 4 options, exactly one correct;
  idempotent re-run; Tesseract-missing graceful skip). The **embedded-text passage path remains
  deferred** pending a real reading PDF (the only sample available was listening); the importer
  currently uses the positional `q<NN>.png` + Tesseract path only. Status approved → implemented
  with that caveat.
- 2026-06-08: **Resolved against a real reading PDF + image (SDD Rule 4).** Findings: (a) the
  reading PDF has **no `"N. Question"` header** and no question text in the text layer — questions
  are delimited by their option block + result label, sequence by document order; (b) each
  question's passage **and prompt** are in a **separate image** (filename carries the sequence,
  e.g. `comprehension-ecrite-25Q39.png`), OCR'd and split at the `reussir-tcfcanada.com` footer;
  (c) option-row curves sit at `x0 ≈ 844` (vs. 898 listening); (d) the `88` icon glyph is now a
  *required* anchor in the option regex. Parser refactored to order-based detection (re-validated:
  reading 19/266, listening 27/437) and the importer rewritten to OCR per-question images. Verified
  end-to-end against the real PDF + the real Q39 image (passage + prompt + 4 options, correct = the
  green option; idempotent). Removed the embedded-text caveat; status now fully **implemented**.
  Goal/Scope/PDF structure/Behaviour.4–5/Data model/Open questions updated to match.
