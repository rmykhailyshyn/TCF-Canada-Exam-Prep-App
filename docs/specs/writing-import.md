# Spec: Writing Task Import

## Status
implemented

> Milestone 10. First of the four Writing-section specs (import → session → evaluation → ui).

## Goal
Provide a CLI command that ingests authored **Writing tasks** into a task bank so the Writing
section has content to present. Unlike reading/listening — which parse a results PDF with an answer
key — Writing tasks are **authored study material** (a prompt, optional sample answer, optional
answer template, word-count guidance) and have **no correct answer**. The import source is therefore
a **directory of markdown files**, one file per task, following the same `--dir` convention as
`npm run ocr` / `npm run transcribe`. The command is platform-agnostic (no OCR/Whisper) and
idempotent.

## Scope
- In scope:
  - CLI command `npm run import:writing -- --dir <path>` that discovers `*.md` task files in a
    directory and persists each as a `writing_tasks` row.
  - A documented markdown file format: YAML front-matter (task number, optional title, optional
    min/max word counts) plus titled body sections for the prompt/instructions, sample answer, and
    answer template.
  - Idempotent upsert on the natural key `(source_file, task_number)`, mirroring the
    `(source_file, sequence)` key used by `questions` (see question-export-import spec).
  - Per-file validation with skip-and-continue on malformed files (clear error, non-zero summary),
    mirroring the reading/listening import resilience.
  - A `--dry-run` flag that parses and prints what would be written without touching the DB.
- Out of scope:
  - PDF/OCR/Whisper parsing (Writing has no media or answer-key fills).
  - Generating sample answers or templates with an LLM (these are authored by hand; LLM scoring is
    the separate writing-evaluation spec).
  - The web UI for importing tasks (CLI only for this milestone; a future question-bank-style
    export/import could follow the M5 pattern).
  - Any session, scoring, or evaluation behaviour (separate specs).

## Behaviour
1. The user runs `npm run import:writing -- --dir <path>`.
2. The command discovers every `*.md` file directly in `<path>`. If none are found it exits non-zero
   with a descriptive error.
3. For each markdown file the command parses:
   - **Front-matter** (YAML between leading `---` fences):
     - `taskNumber` (required, integer 1–3) — which of the three TCF writing tasks this is.
     - `title` (optional, string) — a short label shown in the UI.
     - `minWords` / `maxWords` (optional, integers) — word-count guidance for the response.
   - **Body sections**, identified by markdown `##` headings (case-insensitive, trimmed):
     - `## Prompt` (required) — the task instruction shown to the user in both modes.
     - `## Sample answer` (optional) — a model response shown in **training mode only**.
     - `## Template` (optional) — an answer skeleton/structure shown in **training mode only**.
   - Any text between the front-matter and the first `##` heading is treated as additional
     `instructions` (optional free text).
4. The command validates each file: front-matter present, `taskNumber` in 1–3, a non-empty
   `## Prompt`. A file failing validation is **skipped** with a logged reason; the command continues
   with the rest and reports the count of skipped files in its summary.
5. Each valid file is upserted into `writing_tasks` on the natural key `(source_file, task_number)`:
   - `source_file` is the file's basename (e.g. `task1-message.md`).
   - Insert when absent; **overwrite in place** when the same `(source_file, task_number)` already
     exists (same `writing_tasks.id`, preserving any session references).
6. The command prints per-file progress ("task1-message.md → task 1: inserted" / "overwritten" /
   "skipped (<reason>)") and a final summary `{ inserted, overwritten, skipped, total }`.
7. With `--dry-run`, the command parses and prints the same summary and the parsed fields but
   performs **no** DB writes.
8. The command exits non-zero if the directory is missing/empty or if **every** file was skipped;
   otherwise it exits zero (a partial import with some skips is a success with warnings).

## Data model changes
```
-- spec: docs/specs/writing-import.md §Data model changes
writing_tasks
  id            serial primary key
  source_file   text not null            -- markdown file basename; part of the natural key
  task_number   integer not null         -- 1..3 (TCF writing has three tasks)
  title         text                     -- optional short label
  prompt        text not null            -- the task instruction shown in both modes
  instructions  text                     -- optional extra guidance (free text before the first ##)
  min_words     integer                  -- optional word-count guidance
  max_words     integer                  -- optional word-count guidance
  sample_answer text                     -- training mode only; null when not authored
  template      text                     -- training mode only; null when not authored
  created_at    timestamptz not null default now()

  unique (source_file, task_number)      -- idempotency / override key, mirrors questions(source_file, sequence)
  check (task_number between 1 and 3)
```
No change to existing tables. The session/response/evaluation tables are defined in their own specs
(writing-session, writing-evaluation).

## API contract
None. This is a CLI command with no HTTP surface. The imported tasks are consumed by the Writing
session endpoints defined in the writing-session spec.

## Example task file
```markdown
---
taskNumber: 1
title: Message à un ami
minWords: 60
maxWords: 120
---
Répondez à la tâche en respectant le nombre de mots indiqué.

## Prompt
Un ami français vous a écrit pour vous demander des conseils sur les transports à
utiliser pendant son séjour dans votre ville. Répondez-lui.

## Sample answer
Salut Pierre, … (model answer in French) …

## Template
- Salutation
- Recommandation de transport principal + raison
- Une alternative
- Formule de clôture
```

## Acceptance criteria
Testable pass/fail conditions. Each maps back to the behaviours above.

- [ ] `npm run import:writing -- --dir <path>` discovers `*.md` files in the directory and exits non-zero with a clear message when the directory is missing or empty. (Behaviour.1, 2, 8)
- [ ] A valid file is parsed into front-matter (`taskNumber`, optional `title`, `minWords`, `maxWords`) and body sections (`## Prompt` required, `## Sample answer` / `## Template` optional). (Behaviour.3)
- [ ] A file with no front-matter, a `taskNumber` outside 1–3, or an empty `## Prompt` is skipped with a logged reason and does not abort the run. (Behaviour.4)
- [ ] Re-running the import overwrites the matching `(source_file, task_number)` row in place (same `writing_tasks.id`) rather than inserting a duplicate. (Behaviour.5)
- [ ] The command prints per-file progress and a final `{ inserted, overwritten, skipped, total }` summary. (Behaviour.6)
- [ ] `--dry-run` prints the parsed result and summary but writes nothing to the DB. (Behaviour.7)
- [ ] A `writing_tasks` row carries `source_file`, `task_number` (1–3), `prompt`, and the optional `title`/`instructions`/`min_words`/`max_words`/`sample_answer`/`template`. (Data model)

## Open questions
- **Multiple task files per `task_number`.** The natural key allows several files to share a
  `task_number` (e.g. `task1-message.md` and `task1-email.md`), forming a candidate pool the
  real-mode draw selects from (see writing-session). Confirm this is desired vs. one file per number.
- **Word-count enforcement.** `min_words`/`max_words` are guidance shown in the UI; the import does
  not reject under-length sample answers. Whether scoring penalises out-of-range responses is a
  writing-evaluation concern, not an import concern.

## Revision history
- 2026-06-17: Initial draft (Milestone 10).
- 2026-06-17: Status moved draft → approved.
