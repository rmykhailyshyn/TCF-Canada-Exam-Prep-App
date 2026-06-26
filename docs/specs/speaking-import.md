# Spec: Speaking Task Import

## Status

implemented

> Milestone 11. First of the four Speaking-section specs (import → session → evaluation → ui).
> Mirrors writing-import, but the source is a single JSON file rather than a directory of markdown.

## Goal

Provide a CLI command that ingests authored **Speaking tasks** (TCF _Expression orale_) into a task
bank so the Speaking section has content to present. Like writing tasks, speaking tasks are authored
study material with **no correct answer** — each is a spoken prompt plus a sample answer. The import
source is a **single JSON file**: an array of `{ task, question, answer }` objects. The command is
platform-agnostic (no audio/Whisper at import time) and idempotent.

## Scope

- In scope:
  - CLI command `npm run import:speaking -- --file <path.json>` that reads a JSON array and persists
    each element as a `speaking_tasks` row.
  - The documented JSON element shape: `task` (1–3), `question` (the spoken prompt), `answer` (a
    sample answer).
  - Idempotent upsert on the natural key `(source_file, sequence)`, where `sequence` is the element's
    0-based (or 1-based — see Open questions) index in the array, mirroring `questions(source_file,
sequence)`.
  - Per-element validation with skip-and-continue on malformed entries, and a `--dry-run` flag.
- Out of scope:
  - Audio recording, Whisper transcription, or Claude scoring (those are request-time — see
    speaking-evaluation).
  - Generating sample answers with an LLM (authored by hand).
  - A web import UI (CLI only this milestone).
  - Any session or scoring behaviour (separate specs).

## Behaviour

1. The user runs `npm run import:speaking -- --file <path.json>`.
2. The command reads the file and parses it as a JSON array. If the file is missing, unreadable, or
   not a JSON array, it exits non-zero with a descriptive error.
3. For each array element the command reads:
   - `task` (required, integer 1–3) — which of the three TCF speaking tasks this is (the
     `task_number`).
   - `question` (required, non-empty string) — the spoken prompt shown to the user in both modes.
   - `answer` (optional string) — a model spoken answer shown in **training mode only**.
     The element's array index becomes its `sequence` (the within-file ordinal that, with
     `source_file`, forms the natural key).
4. The command validates each element: `task` in 1–3 and a non-empty `question`. An element failing
   validation is **skipped** with a logged reason (including its index); the command continues with
   the rest and reports the skipped count in its summary.
5. Each valid element is upserted into `speaking_tasks` on `(source_file, sequence)`:
   - `source_file` is the JSON file's basename (e.g. `oral-tasks.json`).
   - Insert when absent; **overwrite in place** when the same `(source_file, sequence)` already
     exists (same `speaking_tasks.id`, preserving any references).
     5b. Because the natural key is `(source_file, sequence)`, **multiple elements may share a `task`
     number** — they form the candidate pool the real-mode/training draw selects from (see
     speaking-session), exactly as multiple imports can share a `sequence` position in reading/listening.
6. The command prints per-element progress ("element 0 → task 3: inserted" / "overwritten" /
   "skipped (<reason>)") and a final summary `{ inserted, overwritten, skipped, total }`.
7. With `--dry-run`, the command parses and prints the same summary and parsed fields but performs
   **no** DB writes.
8. The command exits non-zero if the file is missing/unparseable or if **every** element was skipped;
   otherwise it exits zero (a partial import with some skips is a success with warnings).

## Data model changes

```
-- spec: docs/specs/speaking-import.md §Data model changes
speaking_tasks
  id            serial primary key
  source_file   text not null            -- JSON file basename; part of the natural key
  sequence      integer not null         -- element index within the file; part of the natural key
  task_number   integer not null         -- 1..3 (from the element's `task`)
  question      text not null            -- the spoken prompt shown in both modes
  sample_answer text                     -- training mode only; null when `answer` absent
  created_at    timestamptz not null default now()

  unique (source_file, sequence)         -- idempotency / override key, mirrors questions(source_file, sequence)
  check (task_number between 1 and 3)
```

No change to existing tables. The session/response/evaluation tables are defined in their own specs
(speaking-session, speaking-evaluation).

## API contract

None. This is a CLI command with no HTTP surface. Imported tasks are consumed by the Speaking session
endpoints (speaking-session spec).

## Example import file

```json
[
  {
    "task": 1,
    "question": "Présentez-vous : parlez de votre travail, de vos loisirs et de votre ville.",
    "answer": "Bonjour, je m'appelle… (modèle de réponse orale) …"
  },
  {
    "task": 3,
    "question": "Certaines personnes préfèrent voyager seules. Qu'en pensez-vous ?",
    "answer": "La question du voyage en solitaire revient souvent lorsqu'on évoque…"
  }
]
```

## Acceptance criteria

Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] `npm run import:speaking -- --file <path.json>` reads a JSON array and exits non-zero with a clear message when the file is missing or not a JSON array. (Behaviour.1, 2, 8)
- [ ] Each element is parsed into `task` (1–3), `question` (required), `answer` (optional), with the array index stored as `sequence`. (Behaviour.3)
- [ ] An element with a `task` outside 1–3 or an empty `question` is skipped with a logged reason (incl. index) and does not abort the run. (Behaviour.4)
- [ ] Re-running the import overwrites the matching `(source_file, sequence)` row in place (same `speaking_tasks.id`). (Behaviour.5)
- [ ] Multiple elements sharing a `task` number are all persisted (distinct `sequence`s) and form a candidate pool. (Behaviour.5b)
- [ ] The command prints per-element progress and a final `{ inserted, overwritten, skipped, total }` summary. (Behaviour.6)
- [ ] `--dry-run` prints the parsed result and summary but writes nothing to the DB. (Behaviour.7)
- [ ] A `speaking_tasks` row carries `source_file`, `sequence`, `task_number` (1–3), `question`, and the optional `sample_answer`. (Data model)

## Open questions

- **`sequence` base (0 vs 1).** The element index is stored as `sequence`; 0-based is the natural
  array index, 1-based aligns with the reading/listening 1-indexed `sequence`. Pick one before
  implementation (does not affect behaviour, only the stored value).
- **`question`/`answer` length.** No upper bound is enforced; very long sample answers import as-is.

## Revision history

- 2026-06-17: Initial draft (Milestone 11).
- 2026-06-18: Approved (Milestone 11).
- 2026-06-18: Implemented — `scripts/import-speaking.ts` + pure parser `scripts/lib/speaking-tasks.ts`; `sequence` is the 0-based array index. Sample bank at `samples/speaking-tasks/sample-bank.json`.
