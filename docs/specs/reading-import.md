# Spec: Reading Question Import

## Status
draft

## Goal
Allow a developer to import a full reading section run (39 questions) into the local SQLite
database via a CLI script. A run consists of one HTML file containing all 39 questions with
their answer options and correct answer markers, and 39 PNG images named `q01.png`–`q39.png`,
each containing the passage text for the corresponding question. Once imported, questions are
available for quiz sessions.

## Scope
- In scope:
  - CLI script `npm run import:reading -- --html <path.html> --images <dir/>`
  - HTML parsing of all 39 questions: question text, four options (A–D), correct answer identifier
  - Matching each question to its PNG by 1-based sequence position and filename convention (`q<NN>.png`)
  - OCR extraction of passage text from each PNG via Tesseract CLI
  - Persisting passage + question + options to DB for each of the 39 questions
  - Idempotent import: re-running with the same HTML path does not create duplicates
  - Error reporting for unreadable images or malformed HTML
- Out of scope:
  - In-app import UI (CLI only for now)
  - Runs with fewer or more than 39 questions
  - Automatic LLM explanation generation (separate script, Milestone 6)
  - Editing or deleting imported questions via CLI

## Behaviour
1. The user runs the import script with a path to the HTML file and a path to a directory
   containing the PNG images named `q01.png`–`q39.png`.
2. The script parses the HTML and extracts 39 questions in document order. Each question
   record contains: question text, options A/B/C/D, and the correct answer identifier.
3. For each question at position N (1-based), the script resolves the matching image as
   `<images-dir>/q<NN>.png` (zero-padded to two digits).
4. The script runs Tesseract OCR on the matched PNG and stores the extracted text as the
   passage for that question.
5. Each passage, question, and its options are persisted to the DB. Passage and question
   are linked; each question has exactly one passage.
6. If an import run for the same HTML source path already exists, the script prints a
   duplicate warning and exits without inserting any rows.
7. If the HTML contains fewer or more than 39 parsed questions, the script logs an error
   and exits without writing anything to the DB.
8. If a required PNG file is missing for any question, the script logs which file is missing
   and exits without writing anything to the DB.
9. If Tesseract returns a non-zero exit code for any image, the script logs stderr for that
   image and exits without writing anything to the DB.
10. If any question in the HTML cannot be parsed (missing text, missing options, missing
    correct answer marker), the script logs a descriptive error for that question index and
    exits without writing anything to the DB.
11. On success, the script prints a summary: number of passages and questions imported.

## Data model changes
```
passages
  id          integer primary key
  source_file text not null unique   -- original PNG path, used for duplicate detection
  text        text not null          -- OCR-extracted passage content
  created_at  integer not null       -- unix timestamp

questions
  id           integer primary key
  passage_id   integer references passages(id)   -- null for listening questions
  source_file  text not null unique              -- original HTML path + "?q=<N>" to make it unique per question
  sequence     integer not null                  -- 1-based position within the section run
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
  know which element or attribute marks the correct answer and how questions are delimited
  within the single HTML file. Needs to be confirmed against a real sample file before
  implementation.
- Should the import be atomic (all 39 or nothing) or should partial imports be supported?
  Current behaviour spec assumes atomic (exit on any error). Confirm before implementation.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-04: Revised — corrected import model: one HTML file contains all 39 questions;
  one PNG per question matched by q<NN>.png filename convention; one passage per question strictly.
