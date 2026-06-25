# Spec: LLM Enrichment

## Status

implemented

## Goal

Generate per-question explanations that tell the user, in **English**, why the correct answer is
right and why each of the three incorrect options is wrong — each reason **pointing to the specific
clue** in the source material (the **passage** for reading questions, the **transcript** for
listening questions). Explanations are produced ahead of time by a standalone CLI command that
drives the **local Claude CLI** (not the Anthropic HTTP API, not Ollama) and are stored in the DB.
They surface in learning mode immediately after the user confirms an answer (before the next
question), and — for both learning and real sessions — in review mode after the session ends.

## Scope

- In scope:
  - CLI command `npm run enrich` that iterates over questions without an explanation and generates
    one via the **local `claude` CLI** invoked in non-interactive print mode.
  - English explanations that **cite the clue** in the source: a short quoted snippet from the
    passage (reading) or transcript (listening) that justifies the correct answer and, where
    relevant, that rules out each wrong option.
  - For reading questions the **passage text** is supplied to the model; for listening questions
    the **transcript** (its segments concatenated in order) is supplied.
  - Explanation stored per question (one record covers all four options), idempotently
    (skip questions that already have one).
  - `--question-id <id>` to enrich a single question; `--section <reading|listening>` to limit to
    a section; `--dry-run` to print the prompt + raw model output without writing to the DB.
  - Surfacing the stored explanation: bundled in the learning-mode answer response, and in the
    review payload for **both** learning and real sessions.
- Out of scope:
  - The Anthropic HTTP API and Ollama providers (replaced by the local CLI).
  - Real-time / on-the-fly generation during a live quiz session (explanations are pre-generated;
    a question with no stored explanation simply shows none).
  - Automatic enrichment triggered by import.
  - French or bilingual explanations (English only — see Open questions, resolved).
  - Any schema change — reuses the existing `explanations` table.

## Behaviour

1. The user runs `npm run enrich` (optionally with `--question-id` or `--section` filters).
2. The command reads its configuration from `.env`:
   - `CLAUDE_CLI_BIN`: the Claude CLI binary name/path (default `claude`).
   - `CLAUDE_CLI_MODEL` (optional): passed to the CLI as `--model` (e.g. `claude-opus-4-8`); when
     unset the CLI's own default model is used.
     No API key is read — the local CLI manages its own authentication.
3. For each qualifying question (no existing explanation), the command:
   a. Loads the question text, its four options, and the correct answer label.
   b. **Reading:** loads the linked passage text. **Listening:** loads the transcript segments and
   concatenates them in `sequence` order into a single transcript string.
   c. Builds an English prompt instructing the model to return a **JSON object only** with a
   `correctReason` and a reason for each of `A`–`D`, where every reason quotes or paraphrases the
   relevant clue from the supplied passage/transcript.
   d. Invokes the local CLI non-interactively (`claude -p <prompt>`, plus `--model` when configured),
   captures stdout, and parses the JSON object out of the response.
4. The parsed response yields: one explanation of why the correct answer is right (citing its clue),
   and one explanation per option of why it is wrong (or, for the correct option, what confirms it).
5. The explanation is persisted to the DB linked to the question, with `generated_by` recording the
   CLI + model (e.g. `claude-cli/claude-opus-4-8`, or `claude-cli` when no model was pinned).
6. The command prints progress: "Question 12: generated" or "Question 12: skipped (exists)".
7. On any CLI failure for a question — a non-zero exit, or output from which no valid JSON object can
   be parsed — the command logs the error (including captured stderr), skips that question, and
   continues with the remaining queue.
8. With `--dry-run`, the prompt and the raw model output are printed to stdout and no DB writes occur.

### Surfacing (consumption)

9. **Learning mode** — `POST /api/sessions/:id/answers` returns the full explanation object alongside
   `isCorrect` and `correctLabel`, so it renders immediately after the user confirms, before the
   next question. (Unchanged from the current implementation.)
10. **Review mode** — `GET /api/sessions/:id` includes each question's explanation in its review
    payload for **both** learning and real sessions, so a finished **real** exam shows every
    question's explanation in review (reached from the results screen). This **supersedes**
    review-mode spec §Behaviour.6 ("real mode never shows explanations"): explanations are still
    never shown _during_ a real exam, only afterwards in review.

## Data model changes

None. Reuses the existing `explanations` table (question_id unique; `correct_reason` +
`option_a_reason`..`option_d_reason`; `generated_by`; `generated_at`). Clue citations live inline in
the reason prose, so no new column is needed.

## API contract

The CLI command has no HTTP surface. Stored explanations are surfaced through the two existing
consumption paths:

1. **Bundled in the learning-mode answer response** — `POST /api/sessions/:id/answers` (learning)
   returns the `Explanation` object with `isCorrect` and `correctLabel`. Real mode returns no
   explanation during the exam.
2. **In the review payload** — `GET /api/sessions/:id` carries each question's `explanation` (or
   `null`) in its `results` rows, for both learning and real sessions.

```typescript
type Explanation = {
  correctReason: string; // why the correct answer is right, citing the passage/transcript clue
  optionAReason: string; // why A is wrong (or, for the correct option, what confirms it)
  optionBReason: string;
  optionCReason: string;
  optionDReason: string;
};
```

(There is no standalone `GET /api/questions/:id/explanation` endpoint — review mode reads
explanations through `GET /api/sessions/:id`, so a separate route is unnecessary.)

## Acceptance criteria

Testable pass/fail conditions. Each maps back to the behaviours above.

- [x] `npm run enrich` iterates over questions without an explanation and generates one record per question by invoking the local `claude` CLI. (Behaviour.1, 3, 5)
- [x] Config is read from `.env` (`CLAUDE_CLI_BIN`, optional `CLAUDE_CLI_MODEL`); no API key is required, and a missing binary produces a descriptive error. (Behaviour.2)
- [x] For reading questions the passage text is supplied to the model; for listening questions the transcript (segments concatenated in order) is supplied. (Behaviour.3b)
- [x] A generated `explanations` row has a non-empty English `correct_reason` and a reason for each of A–D, each citing a clue from the passage/transcript, with `generated_by` recording `claude-cli[/model]` and `generated_at` set. (Behaviour.4, 5; Data model)
- [x] `--question-id <id>` enriches only that question; `--section <reading|listening>` limits processing to that section. (Scope)
- [x] `--dry-run` prints the prompt and raw model output to stdout and writes nothing to the DB. (Behaviour.8)
- [x] A question that already has an explanation is skipped and logged as "skipped (exists)". (Behaviour.6)
- [x] A CLI failure (non-zero exit or unparseable output) on one question is logged with stderr and skipped, and the remaining queue continues. (Behaviour.7)
- [x] Learning mode shows the explanation immediately after the answer is confirmed; real-mode sessions show every question's explanation in review after completion (and never during the exam). (Behaviour.9, 10)
- [x] The JSON-parse step tolerates the model wrapping its object in prose or a code fence (extracts the first JSON object); a response with no JSON object is treated as a CLI failure. (Behaviour.3d, 7)

## Open questions

- ~~Explanation language (English / French / both).~~ **Resolved:** English only.
- ~~Structured vs. free-form model output.~~ **Resolved:** the model is asked for a JSON object and
  the command parses it (extracting the first `{…}` to tolerate fences/prose); unparseable output is
  a per-question failure (Behaviour.7).
- **Clue fidelity.** The prompt asks the model to quote the source, but the command does not verify a
  quoted snippet actually appears in the passage/transcript. Light verification (substring check,
  warn on miss) could be added later; deferred.
- **Transcript size for listening.** Very long transcripts are sent whole; if a clip's transcript
  ever exceeds a comfortable prompt budget, truncation/summarisation would be needed. Not a concern
  at current clip lengths.

## Revision history

- 2026-06-04: Initial draft
- 2026-06-05: Clarified two consumption patterns and added the explicit `Explanation` TS shape
- 2026-06-08: Added Acceptance criteria section (testable pass/fail conditions derived from Behaviour).
- 2026-06-08: Status moved draft → approved.
- 2026-06-10: **Revised (Rule 4), status approved → draft pending re-approval.** Provider switched
  from the Anthropic HTTP API / Ollama to the **local `claude` CLI** (`CLAUDE_CLI_BIN`,
  `CLAUDE_CLI_MODEL`; no API key). Explanations are now **English** and must **cite the clue** in the
  passage (reading) or **transcript** (listening) — listening prompts now include the transcript.
  Real-mode sessions surface every question's explanation **in review mode** after completion,
  superseding review-mode §Behaviour.6. Resolved the language and structured-output open questions;
  removed the unused standalone explanation endpoint (review reads via `GET /api/sessions/:id`).
- 2026-06-10: Re-approved and **implemented (Milestone 7).** `scripts/lib/claude.ts` wraps the local
  CLI (`claude -p --output-format json`) with pure, unit-tested prompt/parse helpers;
  `scripts/enrich.ts` (`npm run enrich`) iterates, filters, dry-runs, and persists idempotently. The
  M6 review gate was removed so real-mode review surfaces explanations. Verified end-to-end against a
  live `claude` CLI: a listening question generated an English, transcript-citing explanation;
  a question with a mismatched seed passage triggered the graceful Behaviour.7 skip (model returned
  prose, not JSON); re-run skipped as "exists"; and a completed **real** session's review carried the
  explanation. Status approved → implemented.
