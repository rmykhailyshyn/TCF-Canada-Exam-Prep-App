# Spec: Reading Question Import

## Status
draft

## Goal
Allow a developer to import reading comprehension questions from source files into the
local SQLite database via a CLI script. The source material consists of a PNG image
containing the passage text and one or more HTML files each containing one question with
four answer options and a marker identifying the correct option. Once imported, questions
are available for quiz sessions.

## Scope
- In scope:
  - CLI script `npm run ocr -- --passage <path.png> --questions <q1.html> [q2.html ...]`
  - OCR extraction of passage text from PNG via Tesseract CLI
  - HTML parsing of question text, four options (A–D), and correct answer identifier
  - Persisting passage + questions + options to DB
  - Idempotent import: re-running with the same files does not create duplicates
  - Error reporting for unreadable images or malformed HTML
- Out of scope:
  - In-app import UI (CLI only for now)
  - Batch/folder import (invoked per passage)
  - Automatic LLM explanation generation (separate script, Milestone 6)
  - Editing or deleting imported questions via CLI

## Behaviour
1. The user runs the import script with a passage image path and one or more question HTML paths.
2. The script runs Tesseract OCR on the PNG and stores the extracted passage text in the DB.
3. For each HTML file, the script parses: question text, options A/B/C/D, and the correct answer identifier.
4. Each question is linked to the passage and persisted with its options and correct answer.
5. If an import with the same source file paths has already been run, the script reports a
   duplicate warning and skips without inserting new rows.
6. If Tesseract returns a non-zero exit code, the script logs stderr and exits with a
   non-zero code without writing anything to the DB.
7. If an HTML file cannot be parsed (missing question, missing options, missing correct answer
   marker), the script logs a descriptive error for that file, skips it, and continues with
   the remaining files.
8. On success, the script prints a summary: passage id, number of questions imported.

## Data model changes
```
passages
  id          integer primary key
  source_file text not null unique   -- original PNG path, used for duplicate detection
  text        text not null          -- OCR-extracted passage content
  created_at  integer not null       -- unix timestamp

questions
  id           integer primary key
  passage_id   integer not null references passages(id)
  source_file  text not null unique  -- original HTML path
  text         text not null
  section      text not null check (section in ('reading', 'listening'))
  created_at   integer not null

options
  id          integer primary key
  question_id integer not null references questions(id)
  label       text not null check (label in ('A', 'B', 'C', 'D'))
  text        text not null
  is_correct  integer not null check (is_correct in (0, 1))
```

## API contract
None — CLI script only.

## Open questions
- What is the exact HTML structure used in the source question files? The parser needs to
  know which element or attribute marks the correct answer. Needs to be confirmed against
  a real sample file before implementation.

## Revision history
- 2026-06-04: Initial draft
