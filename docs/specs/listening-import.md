# Spec: Listening Question Import

## Status
draft

## Goal
Allow a developer to import a listening comprehension question from source files into the
local SQLite database via a CLI script. Each question consists of one MP3 audio file and
one HTML file containing the question text, four answer options, and the correct answer
marker. Whisper transcription is run on the audio to produce phrase-level segments with
timestamps, which are stored alongside the audio path to power subtitle display during
playback.

## Scope
- In scope:
  - CLI script `npm run transcribe -- --audio <path.mp3> --question <path.html>`
  - Whisper transcription of MP3 via `mlx-whisper` or `whisper.cpp` CLI (Apple Silicon only)
  - Phrase-level transcript segments with start/end timestamps extracted from Whisper output
  - HTML parsing of question text, four options (A–D), and correct answer identifier
  - Persisting audio path, transcript segments, question, and options to DB
  - Idempotent import: re-running with the same file paths skips without duplicating
  - Error reporting for failed transcription or malformed HTML
- Out of scope:
  - In-app import UI
  - Batch import
  - Word-level timestamp granularity
  - Automatic LLM explanation generation (Milestone 6)

## Behaviour
1. The user runs the import script with an audio file path and a question HTML path.
2. The script runs Whisper on the MP3 and captures phrase-level segments (text, start_ms, end_ms).
3. The script parses the HTML: question text, options A/B/C/D, correct answer identifier.
4. A new question row is inserted (section = 'listening') with no passage_id.
5. Audio metadata (file path) and transcript segments are persisted linked to the question.
6. Options are persisted linked to the question.
7. If a question with the same audio source file path already exists, the script prints a
   duplicate warning and exits without inserting new rows.
8. If Whisper returns a non-zero exit code, the script logs stderr and exits with a
   non-zero code without writing anything to the DB.
9. If the HTML cannot be parsed, the script logs a descriptive error and exits without
   writing anything to the DB.
10. On success, the script prints the new question id and the number of transcript segments stored.

## Data model changes
```
-- questions table already defined in reading-import spec.
-- section = 'listening'; passage_id is null for listening questions.

audio_files
  id           integer primary key
  question_id  integer not null unique references questions(id)
  file_path    text not null unique    -- absolute or repo-relative path to MP3
  duration_ms  integer                 -- optional, populated if Whisper reports it

transcript_segments
  id          integer primary key
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

## Revision history
- 2026-06-04: Initial draft
