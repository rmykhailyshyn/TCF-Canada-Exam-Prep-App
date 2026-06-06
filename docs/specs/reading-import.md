# Spec: Reading Question Import

## Status
draft

## Goal
Allow a developer to import reading comprehension questions from a source directory into the
local PostgreSQL database via a CLI script. The source directory contains exactly one HTML
file listing all questions (up to 39) and one PNG image per question, each containing the
passage text. Once imported, questions are available for quiz sessions.

## Scope
- In scope:
  - CLI script `npm run ocr -- --dir <path>`
  - Directory discovery: locate the single HTML file and all PNG files (up to 39) in the directory
  - OCR extraction of passage text from each PNG via Tesseract CLI
  - HTML parsing of all questions: question text, options A–D, correct answer identifier
  - Matching each question to its corresponding PNG by a defined convention (see Open questions)
  - Persisting passages + questions + options to DB
  - Idempotent import: re-running with the same directory does not create duplicates
  - Error reporting for unreadable images or malformed HTML
- Out of scope:
  - In-app import UI (CLI only for now)
  - Automatic LLM explanation generation (separate script, Milestone 6)
  - Editing or deleting imported questions via CLI

## Behaviour
1. The user runs the import script with a path to a source directory.
2. The script scans the directory, locates the single HTML file and all PNG files; it exits
   with an error if no HTML file is found, more than one HTML file is found, or no PNG files
   are found.
3. The script parses the HTML to extract all questions, each with: question text, options
   A/B/C/D, and correct answer identifier.
4. Each question is matched to its corresponding PNG file by the defined convention.
5. For each PNG, the script runs Tesseract OCR and stores the extracted text as a passage.
6. Each question is linked to its passage and persisted with its options and correct answer.
7. If a PNG with the same file path already exists in the DB, the script prints a duplicate
   warning for that file and skips it (and its linked question) without inserting new rows.
8. If Tesseract returns a non-zero exit code for a PNG, the script logs stderr and skips
   that PNG and its linked question; remaining PNGs continue to be processed.
9. If the HTML cannot be parsed (missing questions, missing options, missing correct answer
   markers), the script logs a descriptive error and exits without writing anything to the DB.
10. On success, the script prints a summary: number of passages imported, number of questions imported.

## Data model changes
```
passages
  id          serial primary key
  source_file text not null unique   -- original PNG path, used for duplicate detection
  text        text not null          -- OCR-extracted passage content
  created_at  timestamptz not null default now()

questions
  id           serial primary key
  passage_id   integer references passages(id)
  source_file  text not null unique  -- original HTML path
  text         text not null
  section      text not null check (section in ('reading', 'listening'))
  created_at   timestamptz not null default now()

options
  id          serial primary key
  question_id integer not null references questions(id)
  label       text not null check (label in ('A', 'B', 'C', 'D'))
  text        text not null
  is_correct  boolean not null
```

## API contract
None — CLI script only.

## Open questions
- What is the exact HTML structure of the source file? Based on the listening HTML sample,
  the reading HTML likely uses the same WordPress LearnDash `wpProQuiz` format. Needs to be
  confirmed against a real reading HTML sample. If so, the same selector patterns apply
  (see listening-import.md §HTML structure) with `<img src>` replacing `<audio src>`.
- How are PNG files matched to questions in the HTML? If the reading format mirrors the
  listening format, the PNG filename will be embedded in an `<img src>` URL inside each
  question element — same basename-matching approach as for MP3s. Confirm against a sample.
- **Correct answers may not be in the HTML** (same issue as listening — answers are
  server-side in wpProQuiz). Confirm whether a companion answer key file is needed, using
  the same approach decided for listening-import.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-05: Changed CLI from per-file flags to `--dir`; one HTML + multiple PNGs per directory
- 2026-06-05: Updated open questions based on wpProQuiz HTML sample from listening section;
  flagged likely absence of correct answers in HTML
