# Spec: Listening Question Import

## Status
draft

## Goal
Allow a developer to import listening comprehension questions from a source directory into the
local PostgreSQL database via a CLI script. The source directory contains exactly one HTML
file (in the WordPress LearnDash `wpProQuiz` format exported from the exam prep site) and
one local MP3 audio file per question. The HTML encodes question order and option text; the
correct answer is **not present in the HTML** and must be supplied separately (see Open
questions). Whisper transcription is run on each audio file to produce phrase-level segments
with timestamps, which are stored alongside the audio path to power subtitle display.

## Scope
- In scope:
  - CLI script `npm run transcribe -- --dir <path>`
  - Directory discovery: locate the single HTML file and all MP3 files (up to 39) in the directory
  - Whisper transcription of each MP3 via `mlx-whisper` or `whisper.cpp` CLI (Apple Silicon only)
  - Phrase-level transcript segments with start/end timestamps extracted from Whisper output
  - HTML parsing: question order, instruction text, options A–D (text where present)
  - MP3 matching: extract the filename from the audio `src` URL in each question's HTML and
    match it against local files in the directory (case-insensitive basename match)
  - Persisting audio paths, transcript segments, questions, and options to DB
  - Correct answer stored as `null` initially; populated later via a separate answer-key import
  - Idempotent import: re-running with the same directory skips already-imported audio files
  - Error reporting for failed transcription or malformed HTML
- Out of scope:
  - In-app import UI
  - Word-level timestamp granularity
  - Automatic LLM explanation generation (Milestone 6)
  - Correct answer extraction (not available in this HTML format)

## HTML structure (wpProQuiz format)

The HTML file is a saved page from the LearnDash quiz platform. Relevant selectors:

```
Question list:     ol.wpProQuiz_list > li.wpProQuiz_listItem
Question number:   li > div.wpProQuiz_question_page .lqc-number (first occurrence)
Audio src URL:     li div.wpProQuiz_question_text audio source[type="audio/mpeg"] → src attr
Instruction text:  li div.wpProQuiz_question_text strong (innerText)
Option items:      li ul.wpProQuiz_questionList li.wpProQuiz_questionListItem
Option label:      span[style*="color: black"] innerText  →  "A" | "B" | "C" | "D"
Option text:       label innerText after removing the label and invisible spans
                   (may be empty when the options are spoken in the audio clip)
Correct answer:    absent — not encoded in this HTML format
```

MP3 filename matching: strip the path and query string from the audio `src` URL
(e.g. `https://…/20Q7.mp3?_=7` → `20Q7.mp3`), then find the local file whose
basename matches (case-insensitive). Log a warning and skip the question if no
matching local file is found.

## Behaviour
1. The user runs the import script with a path to a source directory.
2. The script scans the directory, locates the single HTML file and all MP3 files; it exits
   with an error if no HTML file is found, more than one HTML file is found, or no MP3 files
   are found.
3. The script parses the HTML using the selectors above to extract each question's: number,
   instruction text, options A–D (label + text).
4. For each question the script resolves its local MP3 by matching the filename embedded in
   the audio `src` URL against files present in the directory.
5. If no local MP3 matches the filename in the HTML, the script logs a warning for that
   question and skips it; remaining questions continue to be processed.
6. For each matched MP3, the script runs Whisper and captures phrase-level segments
   (text, start_ms, end_ms).
7. A new question row is inserted (section = 'listening', correct answer = null initially).
8. Audio metadata (file path) and transcript segments are persisted linked to the question.
9. Options are persisted linked to the question (is_correct = false for all until answer key
   is imported separately).
10. If an MP3 with the same file path already exists in the DB, the script prints a duplicate
    warning for that file and skips it (and its linked question) without inserting new rows.
11. If Whisper returns a non-zero exit code for an MP3, the script logs stderr and skips
    that MP3 and its linked question; remaining MP3s continue to be processed.
12. If the HTML cannot be parsed (no `ol.wpProQuiz_list` found), the script logs a descriptive
    error and exits without writing anything to the DB.
13. On success, the script prints a summary: number of questions imported, total transcript
    segments stored, number of questions skipped (no matching MP3).

## Data model changes
```
-- questions table already defined in reading-import spec.
-- section = 'listening'; passage_id is null for listening questions.

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
- **Correct answers are not in the HTML.** How should they be supplied? Options:
  (a) A companion `answers.json` file in the same directory (`{"1": "B", "2": "D", ...}`);
  (b) A separate `npm run answers -- --dir <path> --answers <file>` command applied after
  import; (c) Manual update via DB tooling. Needs a decision before the quiz UI can show
  feedback in learning mode.

## Revision history
- 2026-06-04: Initial draft
- 2026-06-05: Changed CLI from per-file flags to `--dir`; one HTML + multiple MP3s per directory
- 2026-06-05: Documented wpProQuiz HTML parsing structure; resolved MP3 matching (filename
  from audio src URL); flagged that correct answers are absent from this HTML format
