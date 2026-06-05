# Spec: Listening Question Import

## Status
draft

## Goal
Allow a developer to import a full listening section run (39 questions) into the local SQLite
database via a CLI script. A run consists of one HTML file containing all 39 questions with
their answer options and correct answer markers, and 39 MP3 audio files named `q01.mp3`–`q39.mp3`,
each containing the audio clip for the corresponding question. Whisper transcription is run on
each MP3 to produce phrase-level segments with timestamps, stored alongside the audio path to
power subtitle display during playback.

## Scope
- In scope:
  - CLI script `npm run import:listening -- --html <path.html> --audio <dir/>`
  - HTML parsing of all 39 questions: question text, four options (A–D), correct answer identifier
  - Matching each question to its MP3 by 1-based sequence position and filename convention (`q<NN>.mp3`)
  - Whisper transcription of each MP3 via `mlx-whisper` or `whisper.cpp` CLI (Apple Silicon only)
  - Phrase-level transcript segments with start/end timestamps extracted from Whisper output
  - Persisting audio path, transcript segments, question, and options to DB for each of the 39 questions
  - Idempotent import: re-running with the same HTML path does not create duplicates
  - Error reporting for failed transcription or malformed HTML
- Out of scope:
  - In-app import UI
  - Runs with fewer or more than 39 questions
  - Word-level timestamp granularity
  - Automatic LLM explanation generation (Milestone 6)

## Behaviour
1. The user runs the import script with a path to the HTML file and a path to a directory
   containing the MP3 files named `q01.mp3`–`q39.mp3`.
2. The script parses the HTML and extracts 39 questions in document order. Each question
   record contains: question text, options A/B/C/D, and the correct answer identifier.
3. For each question at position N (1-based), the script resolves the matching audio file as
   `<audio-dir>/q<NN>.mp3` (zero-padded to two digits).
4. The script runs Whisper on the matched MP3 and captures phrase-level segments (text, start_ms, end_ms).
5. The question (section = 'listening', no passage_id), its options, audio metadata, and
   transcript segments are persisted to the DB.
6. If an import run for the same HTML source path already exists, the script prints a
   duplicate warning and exits without inserting any rows.
7. If the HTML contains fewer or more than 39 parsed questions, the script logs an error
   and exits without writing anything to the DB.
8. If a required MP3 file is missing for any question, the script logs which file is missing
   and exits without writing anything to the DB.
9. If Whisper returns a non-zero exit code for any audio file, the script logs stderr for
   that file and exits without writing anything to the DB.
10. If any question in the HTML cannot be parsed (missing text, missing options, missing
    correct answer marker), the script logs a descriptive error for that question index and
    exits without writing anything to the DB.
11. On success, the script prints a summary: number of questions imported and total transcript
    segments stored.

## Data model changes
```
-- questions table defined in reading-import spec.
-- section = 'listening'; passage_id is null for listening questions.

audio_files
  id           integer primary key
  question_id  integer not null unique references questions(id)
  file_path    text not null unique    -- absolute or repo-relative path to MP3
  duration_ms  integer                 -- optional, populated if Whisper reports it

transcript_segments
  id          integer primary key
  question_id integer not null references questions(id)
  sequence    integer not null         -- 1-based ordering within the audio
  text        text not null
  start_ms    integer not null
  end_ms      integer not null
```

## API contract
None — CLI script only.

## Open questions
- What is the exact HTML structure used in the source question files? The parser needs to
  know which element or attribute marks the correct answer and how questions are delimited
  within the single HTML file. Needs to be confirmed against a real sample file before
  implementation.
- Which Whisper CLI variant takes priority: `mlx-whisper` or `whisper.cpp`? Should the
  script auto-detect or read from an env var (`WHISPER_CMD`)?
- Does Whisper output segments as JSON directly, or does the script need to parse a text
  format? Confirm the `--output_format json` flag is available in both CLI variants.
- Should the import be atomic (all 39 or nothing) or should partial imports be supported?
  Current behaviour spec assumes atomic (exit on any error). Confirm before implementation.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-04: Revised — corrected import model: one HTML file contains all 39 questions;
  one MP3 per question matched by q<NN>.mp3 filename convention; no passage for listening questions.
