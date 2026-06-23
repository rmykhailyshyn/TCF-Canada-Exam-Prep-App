# Spec: Question Bank Export / Import

## Status
implemented

## Goal
Let the user back up and share imported questions through the web app. From a dedicated
"Question Bank" page the user can **export** questions — filtered by section (reading or
listening) and by complexity (one or more of the six difficulty bands) — as a single JSON
file, and later **import** a previously exported file back into the local database. Importing
can either skip questions that already exist or **override** them in place, so a corrected or
enriched export can be re-applied without losing the link to past session results. This makes
the locally-imported question bank portable and re-seedable without re-running the OCR/Whisper
pipelines.

## Scope
- In scope:
  - A web UI ("Question Bank" page) with an **Export** panel and an **Import** panel.
  - Export filtering by **section** (reading, listening, or both) and by **complexity**
    (any subset of the six difficulty bands, or all). Complexity is derived from each
    question's `sequence` via the band map (see quiz-session spec §Scoring), not a stored
    column.
  - A versioned JSON export document carrying, per question: its natural key
    (`section`, `sourceFile`, `sequence`), prompt text, the four options (with the answer
    key), the passage (reading), and the transcript segments + audio reference (listening).
  - Import with an **override** toggle: match each incoming question to an existing one by the
    natural key `(source_file, sequence)`; insert when absent, skip or overwrite when present.
  - Override updates rows **in place** (same `questions.id`) so `question_results` /
    `sessions` history stays linked.
  - Structural + answer-key validation of the uploaded file before any write; an import that
    fails validation writes nothing.
  - Two API endpoints (`GET /api/questions/export`, `POST /api/questions/import`) returning the
    standard JSON envelope.
- Out of scope:
  - **Bundling the audio binary.** The listening export carries the transcript and the audio
    *filename* + duration only — never the MP3 bytes. Playback after import requires the MP3 to
    be present in the configured media directory (see Open questions).
  - Exporting LLM explanations (`explanations` table), sessions, or `question_results`.
  - Editing or deleting questions through this UI (export/import only).
  - CLI export/import (this feature is web-UI driven; the OCR/Whisper importers remain the CLI
    entry points for *first* import).
  - Any schema change — this feature reuses the existing tables and natural key.

## Behaviour

### Export
1. The user opens the **Question Bank** page and the **Export** panel.
2. The user selects a **section** filter: Reading, Listening, or Both (default Both).
3. The user selects a **complexity** filter: any subset of the six difficulty bands
   (Beginner, Elementary, Intermediate, Upper-Intermediate, Advanced, Expert), or "All
   levels" (default All). The bands map to `sequence` ranges per the quiz-session §Scoring
   table.
4. On confirming, the app calls the export endpoint and receives a JSON export document
   containing every question matching the section + complexity filter, each with its options,
   answer key, passage (reading) or transcript + audio reference (listening).
5. The browser downloads the document as a file named
   `tcf-export-<section>-<complexity>-YYYYMMDD.json` (e.g.
   `tcf-export-reading-intermediate-20260609.json`; `all` is used for an unfiltered axis).
6. If no questions match the filter, the app shows an empty-result notice and does not produce
   a file.

### Import
7. In the **Import** panel the user selects a previously exported JSON file from disk.
8. The user chooses whether to **override existing questions** (a checkbox, default off).
9. On submit, the app parses the file and posts it to the import endpoint with the override
   flag. The server validates the document's `formatVersion` and structure; a malformed or
   unsupported file is rejected with a descriptive error and nothing is written.
10. The server resolves each incoming question against the database by the natural key
    `(source_file, sequence)`:
    - **Absent** → insert the question (and its passage / options / transcript / audio
      reference). Counted as *inserted*.
    - **Present, override OFF** → leave it untouched. Counted as *skipped*.
    - **Present, override ON** → overwrite the existing row's prompt text, options (full
      replace of the four), passage text, transcript segments, and audio reference, **keeping
      the same `questions.id`**. Counted as *overridden*.
11. The whole import runs in a single transaction: if any question fails to apply, the import
    rolls back and the database is left unchanged.
12. After a successful import the app shows a summary: number inserted, overridden, skipped,
    and the total processed, plus any non-fatal warnings (e.g. audio file not found on disk).

### Validation
13. The document is rejected (`INVALID_FORMAT`) if `formatVersion` is missing or unsupported,
    or if `questions` is not an array.
14. Each question is rejected (`VALIDATION_FAILED`, naming the offending key) unless it has:
    a `section` of `reading` or `listening`; a non-empty `sourceFile`; an integer `sequence`
    in `1..39`; non-empty `text`; exactly four options labelled `A`–`D` with **exactly one**
    `isCorrect: true`; and, for listening questions, a transcript array (possibly empty) and an
    audio reference. A `difficulty` field, if present, is informational only — the band is
    recomputed from `sequence` on both export and import.

## Data model changes
None. This feature reuses `questions`, `options`, `passages`, `audio_files`, and
`transcript_segments` as defined by the reading-import and listening-import specs.

Key points that make override safe without a schema change:
- The override identity is the existing `UNIQUE(source_file, sequence)` on `questions`.
- `question_results` references `question_id` and stores `chosen_label` (`A`–`D`) — not option
  ids — so replacing a question's option rows on override does not break historical results.
- On override, the linked `passages` row is updated in place, `transcript_segments` for the
  question are deleted and re-inserted from the document, and the `audio_files` row's
  `file_path` / `duration_ms` are updated.

## Export document format
```jsonc
{
  "formatVersion": 1,
  "exportedAt": "2026-06-09T12:00:00.000Z",   // informational
  "filter": { "section": "reading" | "listening" | "all",
              "difficulties": ["intermediate", ...] | "all" },
  "questions": [
    {
      "section": "reading" | "listening",
      "sourceFile": "/abs/path/results.pdf",   // part of the natural key
      "sequence": 12,                            // part of the natural key (1..39)
      "difficulty": "intermediate",              // derived from sequence; informational
      "text": "Question prompt…",
      "options": [
        { "label": "A", "text": "…", "isCorrect": false },
        { "label": "B", "text": "…", "isCorrect": true  },
        { "label": "C", "text": "…", "isCorrect": false },
        { "label": "D", "text": "…", "isCorrect": false }
      ],
      "passage": { "sourceFile": "…25Q12.png", "text": "…" } | null,  // reading
      "audio": { "fileName": "q12.mp3", "durationMs": 30000 } | null, // listening
      "transcript": [                                                  // listening
        { "sequence": 0, "text": "…", "startMs": 0, "endMs": 1200 }
      ]
    }
  ]
}
```
The natural key is `(section, sourceFile, sequence)`; `section` is carried for clarity but the
DB-level match is on `(source_file, sequence)`. The `audio.fileName` is the **basename** only;
import records it as `listening/<fileName>` (relative to `MEDIA_DIR`) and resolves it against the
configured media directory under the `listening/` subfolder.

## API contract

### GET /api/questions/export
Return the filtered export document.
```
Query:    section?    = "reading" | "listening" | "all"  (default "all")
          difficulty? = comma-separated band slugs, or "all" (default "all")
                        e.g. ?section=reading&difficulty=intermediate,advanced
Response: { "data": <ExportDocument>, "error": null }
Error (bad section):    { "data": null, "error": { "code": "INVALID_SECTION",    "message": "…" } }
Error (bad band slug):  { "data": null, "error": { "code": "INVALID_DIFFICULTY", "message": "…" } }
```
The response carries the document as `data` (envelope rule); the client serializes `data` to a
file to trigger the download. `questions` is `[]` when nothing matches (the client then shows
the empty-result notice rather than downloading).

### POST /api/questions/import
Apply an export document to the database.
```
Request:  { "document": <ExportDocument>, "override": boolean }
Response: { "data": { "inserted": number, "overridden": number, "skipped": number,
                      "total": number, "warnings": string[] }, "error": null }
Error (bad envelope):   { "data": null, "error": { "code": "INVALID_FORMAT",     "message": "…" } }
Error (bad question):   { "data": null, "error": { "code": "VALIDATION_FAILED",  "message": "… (question <section>/<sequence>)" } }
```
`override` defaults to `false` when omitted. On `VALIDATION_FAILED` or `INVALID_FORMAT` the
transaction is rolled back and the database is unchanged.

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [x] The Question Bank page exposes an Export panel with section (Reading/Listening/Both) and complexity (band subset / All) filters. (Behaviour.1, 2, 3)
- [x] `GET /api/questions/export` returns a `formatVersion`-stamped document whose `questions` are exactly those matching the section + complexity filter, each with four options (one `isCorrect`), and a passage (reading) or transcript + audio reference (listening). (Behaviour.4; Export document format)
- [x] `GET /api/questions/export` returns `INVALID_SECTION` / `INVALID_DIFFICULTY` for unknown filter values, and a document with `questions: []` when nothing matches (no file produced by the UI). (Behaviour.6; API contract)
- [x] The exported file downloads with a name encoding the section, complexity, and date. (Behaviour.5)
- [x] The Import panel accepts a JSON file and an "override existing" checkbox (default off). (Behaviour.7, 8)
- [x] `POST /api/questions/import` inserts questions whose `(source_file, sequence)` is absent, and with override OFF leaves existing ones untouched (counted as skipped). (Behaviour.10)
- [x] With override ON, an existing question is overwritten in place — same `questions.id`, options/passage/transcript/audio replaced — and a prior `question_results` row for that question still resolves. (Behaviour.10; Data model)
- [x] A document with a missing/unsupported `formatVersion`, a non-array `questions`, or a question failing the answer-key/shape rules is rejected (`INVALID_FORMAT` / `VALIDATION_FAILED`) and the database is left unchanged. (Behaviour.9, 11, 13, 14)
- [x] A successful import returns and displays `{ inserted, overridden, skipped, total, warnings }`. (Behaviour.12; API contract)
- [x] A round trip (export a band → import into an empty DB → the questions, options, answer key, and passages/transcripts match the originals) reproduces the source data. (Behaviour.4, 10)

## Open questions
- **Cross-machine portability of the natural key.** `(source_file, sequence)` embeds a local
  absolute path. Exporting on machine A and importing on machine B — where the same questions
  were first imported under a *different* `source_file` path — will not match, so override falls
  back to insert (duplicates). A portable per-question UUID column would solve this but needs a
  migration + backfill; deferred for now. Acceptable while the app is single-machine.
- **Audio binaries.** The export references `audio.fileName` only. After importing a listening
  question on a machine that lacks the MP3, the question imports (with a warning) but audio
  playback fails until the file is placed in the media directory. A future "bundle audio"
  option (zip or base64) could make the export self-contained.
- **Both-section file on import.** A "Both" export yields a mixed-section file; import handles
  each question by its own `section`. Confirmed in scope; no per-file section lock.
- **LLM explanations.** Not exported in v1. If explanations become valuable to share, a future
  revision can add an `explanation` object per question.

## Revision history
- 2026-06-09: Initial draft. Web-UI + API surface; transcript + audio-path reference (no binary);
  override keyed on the existing `(source_file, sequence)` natural key (no schema change).
- 2026-06-09: Implemented (Milestone 5). Pure validation/filter core in
  `server/lib/export-import.ts` (22 unit tests); DB read/write in `server/services/export-import.ts`;
  routes on the existing `questionsRouter`; client `QuestionBankPage` at `/question-bank`. The
  spec's "configured media directory" (§Export document format, Open questions) is resolved by a
  new `MEDIA_DIR` env var (defaults to `<repo-root>/media`); import joins the exported audio
  basename onto it and warns — non-fatally — when the MP3 is absent on disk. No schema change.
  Verified end-to-end against the dev DB: export→import round trip, override-in-place preserves
  `questions.id`, and the `INVALID_SECTION`/`INVALID_DIFFICULTY`/`INVALID_FORMAT`/`VALIDATION_FAILED`
  error paths.
- 2026-06-23: `MEDIA_DIR` default moved to `<repo-root>/data/media` (alongside the SQLite DB) and
  media is now laid out in section subfolders. Import records the exported audio basename as
  `listening/<fileName>` (relative to `MEDIA_DIR`) instead of an absolute path; the missing-file
  warning checks the `listening/` subfolder. Exported passage `source_file` values are likewise
  MEDIA_DIR-relative. No format/schema change.
