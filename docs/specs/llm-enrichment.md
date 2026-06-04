# Spec: LLM Enrichment

## Status
draft

## Goal
Generate per-question explanations that tell the user why the correct answer is right and
why each of the three incorrect options is wrong. Explanations are produced by a standalone
CLI script (not during question import) and stored in the DB. They surface in learning mode
after the user submits a final answer, and in review mode. The script supports Claude API
and self-hosted models via Ollama, configured through environment variables.

## Scope
- In scope:
  - CLI script `npm run enrich` that iterates over questions without explanations and
    generates them via LLM
  - Support for Claude API (Anthropic) and Ollama as providers, selected via `.env`
  - Explanation stored per question (one explanation record covers all four options)
  - Optional `--question-id <id>` flag to enrich a single question
  - Optional `--section <reading|listening>` flag to enrich all questions in a section
  - Dry-run flag `--dry-run` to print the prompt and response without writing to DB
  - Skip questions that already have an explanation (idempotent)
- Out of scope:
  - Real-time generation during a quiz session
  - Automatic enrichment triggered by import
  - Translation or localisation of explanations
  - Fine-tuning or model training

## Behaviour
1. The user runs `npm run enrich` (optionally with `--question-id` or `--section` filters).
2. The script loads LLM configuration from `.env`:
   - `LLM_PROVIDER`: `claude` or `ollama`
   - `LLM_MODEL`: model name (e.g. `claude-opus-4-8` or `llama3`)
   - `ANTHROPIC_API_KEY`: required when `LLM_PROVIDER=claude`
   - `OLLAMA_BASE_URL`: required when `LLM_PROVIDER=ollama` (e.g. `http://localhost:11434`)
3. For each qualifying question (no existing explanation), the script:
   a. Builds a prompt containing the question text, all four options, and the correct answer label.
   b. For reading questions, the passage text is included in the prompt.
   c. Sends the prompt to the configured LLM and receives a structured response.
4. The response contains: one explanation of why the correct answer is right, and one
   explanation per incorrect option of why it is wrong.
5. The explanation is persisted to the DB linked to the question.
6. The script prints progress: "Question 12: generated" or "Question 12: skipped (exists)".
7. On any LLM API error, the script logs the error, skips that question, and continues
   with the remaining queue.
8. With `--dry-run`, the prompt is printed to stdout and no DB writes occur.

## Data model changes
```
explanations
  id               integer primary key
  question_id      integer not null unique references questions(id)
  correct_reason   text not null     -- why the correct answer is right
  option_a_reason  text not null     -- why A is wrong (or reinforces why A is correct)
  option_b_reason  text not null
  option_c_reason  text not null
  option_d_reason  text not null
  generated_by     text not null     -- e.g. "claude/claude-opus-4-8" or "ollama/llama3"
  generated_at     integer not null  -- unix timestamp
```

## API contract
None — CLI script only. Explanation data is consumed by the quiz-session and review-mode
API endpoints already defined in those specs.

### GET /api/questions/:id/explanation
Return the explanation for a question (used by quiz-session and review-mode UIs).
```
Response: { "data": { "explanation": Explanation | null }, "error": null }
```

## Open questions
- What language should the explanations be in — English, French, or both? TCF Canada is
  a French-language test, so explanations in French may be more useful for study. Needs
  confirmation before the prompt template is written.
- Should the LLM response be structured (JSON schema enforced) or free-form prose parsed
  by the script? Structured output is more reliable but requires model support for
  tool/function calling or JSON mode.

## Revision history
- 2026-06-04: Initial draft
