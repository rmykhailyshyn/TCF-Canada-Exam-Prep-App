# Spec: Content Seeding + Online Practice Mode + Client Capability Gating

## Status
draft

## Goal
Make the deployed Cloudflare instance (Milestone 15) usable: get locally-imported content into D1 and
R2, and adapt the client so the online (practice-only) experience is coherent — no broken buttons for
features the cloud cannot provide. Content originates **locally** (the OCR/Whisper/Claude pipelines are
local-only), so the flow is **import locally → push to cloud**. The client learns what the backend can
do from the `/api/health` `capabilities` flag (Milestone 14) and hides the AI-scoring, correction, and
import affordances when they are off, while still letting the user read, listen, and practice all four
sections with sample answers shown for Writing/Speaking. This is the milestone that turns the running
cloud runtime into a working study tool for the single user, and it defines the online behaviour of
Writing/Speaking when AI scoring is unavailable.

## Scope
- In scope:
  - A **content-deploy script** (`npm run deploy:content`, local/Node) that pushes the local content to
    the deployed instance:
    1. reuses the existing **export** service (`server/services/export-import.ts`) to produce the
       question/task JSON, and loads it into **D1** (via the portable import endpoint on the Worker, or
       `wrangler d1 execute`);
    2. uploads the referenced **media** (audio MP3s, passage images) from `MEDIA_DIR` to the **R2**
       bucket, keyed to match `audio_files.file_path` / `passages.source_file`.
  - **Online practice-mode behaviour** (surfaced via `capabilities.aiScoring = false`):
    - Writing **submit** locks the response (sets `submittedAt`, computes `wordCount`) **without** an
      evaluation; no score is produced.
    - Speaking online = record + playback + sample answer, **no transcription and no score** (recording
      may be stored in R2 for playback; no Whisper/Claude step).
    - **Correction** is unavailable online.
    - The UI presents **sample answers / templates** in place of a score for Writing/Speaking.
  - **Client capability-gating**: the client fetches `/api/health` capabilities on load and conditionally
    **hides** the AI-score/feedback, "Get correction", and import-UI affordances when their capability is
    off — no hardcoded environment switch in the client. `client/src/lib/api.ts` gains a
    `fetchCapabilities()` helper consumed by the Writing/Speaking features and the Question Bank
    (export/import) page.
  - Documentation: CLAUDE.md command + a short "deploying content" runbook; the writing/speaking
    evaluation specs and `progress-tracking.md` annotated to note AI scoring is a local/full-runtime
    capability and online sessions are unscored practice.
- Out of scope:
  - Running any AI/transcription online (architecturally impossible on the free tier; explicitly local-only).
  - Editing/deleting content via the cloud (content is push-only from local).
  - Multi-user features, per-user history isolation (single user by decision).
  - Automatic/continuous sync — `deploy:content` is run manually when local content changes.

## Behaviour
1. After `npm run deploy:content`, the deployed instance has the exported reading/listening questions
   and writing/speaking tasks in D1, and their audio/passage-image media in R2; the content is playable
   online (audio streams from R2 with seeking).
2. Re-running `deploy:content` is **idempotent** — it reuses the import feature's `(source_file,
   sequence)` / `(source_file, task_number)` override semantics so content updates in place without
   duplicates, and re-uploads media to the same R2 keys.
3. On load, the client reads `capabilities` from `/api/health`. When `imports = false` (online), the
   Question Bank **import** panel is hidden or disabled with an explanatory note; **export** (a read) may
   remain available.
4. When `aiScoring = false` (online): Writing shows the prompt, editor, word counter, and — after submit
   — the **sample answer / template** instead of a /20 score + feedback; there is no "Get correction"
   button.
5. When `transcription = false` (online): Speaking lets the user record and play back their answer and
   shows the sample answer, but performs no transcription and shows no score/feedback.
6. On the **local** runtime (capabilities all `true`), Writing/Speaking behave exactly as today — AI
   scoring on submit, correction on request, full Question Bank import — with **no change**.
7. Completing a session online still records history (sessions + responses) consistent with the existing
   schema; unscored writing/speaking responses appear in history without a /20 (no fabricated score).

## Data model changes
None. Online submit reuses the existing `writing_responses` / `speaking_responses` rows and simply omits
the corresponding `*_evaluations` row when AI scoring is unavailable. (History/score reads already treat a
missing evaluation as "not yet scored.")

## API contract
No new endpoints. Behaviour is gated by the existing `capabilities` flag (Milestone 14) and the existing
portable endpoints (Milestone 15):
- The **import** endpoint is the load path into D1 (already portable, pure-DB). The content-deploy script
  is its client; if `wrangler d1 execute` is used instead, no endpoint is involved for the DB load.
- Online Writing **submit** returns the response locked but **without** an evaluation payload when
  `aiScoring = false`; the client renders the sample answer instead of a score. The submit/complete
  request and response shapes are otherwise unchanged.
- `fetchCapabilities()` is a client helper over the existing `GET /api/health`; no server change.

## Acceptance criteria
- [ ] `npm run deploy:content` loads the local export into D1 and uploads referenced media to R2; the content is then playable on the deployed instance, with audio seeking via R2 range requests. (Behaviour.1)
- [ ] Re-running `deploy:content` produces no duplicate questions/tasks (override-in-place on the natural keys) and overwrites media at the same R2 keys. (Behaviour.2)
- [ ] With `imports = false`, the client hides/disables the Question Bank import panel with an explanatory note. (Behaviour.3)
- [ ] With `aiScoring = false`, Writing submit locks the response without an evaluation, no score/feedback or "Get correction" is shown, and the sample answer/template is presented instead. (Behaviour.4, 7)
- [ ] With `transcription = false`, Speaking supports record + playback + sample answer but produces no transcript/score. (Behaviour.5, 7)
- [ ] On the local runtime (all capabilities `true`), Writing/Speaking/Question Bank behave exactly as before this milestone — verified by the existing suites passing unchanged. (Behaviour.6)
- [ ] Online-completed writing/speaking sessions appear in history without a fabricated /20 (missing evaluation reads as unscored). (Behaviour.7)
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` all pass; e2e (local, full-capability) shows no behaviour change. (Behaviour.6)

## Open questions
- **D1 load mechanism: import endpoint vs. `wrangler d1 execute`.** Posting the export JSON to the
  Worker's portable import endpoint reuses validated, idempotent logic and goes through Access; generating
  SQL for `wrangler d1 execute --file` avoids an HTTP round-trip but duplicates write logic. Default:
  reuse the import endpoint. To confirm payload size limits for a full bank during implementation.
- **Media upload mechanism.** `wrangler r2 object put` per file is simple but slow for many MP3s; the R2
  S3-compatible API with an upload script is faster. Default: a small Node upload step in
  `deploy:content`; decided at implementation. Must key objects to match `file_path`/`source_file`.
- **Should the user's online speaking recordings be persisted to R2 at all?** Practice-only implies they
  add little value without scoring; persisting enables self-review of playback. Default: persist for
  playback within the session; lifecycle/retention is a minor follow-up, not blocking.
- **Export availability online.** Export is a pure read and harmless online, but it is an "admin" action.
  Whether to also hide it under a capability is a small UX call; default keep export, hide only import.
- **Capabilities fetch failure.** If `/api/health` is unreachable at load, the client should fail safe
  (assume the most restrictive capabilities) rather than show actions that will 404. To confirm the
  default-deny behaviour during implementation.

## Revision history
- 2026-06-20: Initial draft (Milestone 16). Part of the Cloudflare-hosting initiative; depends on
  `database-sqlite.md` (M13), `server-runtime.md` (M14, `capabilities` + portable import/export), and
  `cloud-deployment.md` (M15, D1/R2/Worker). Defines the online practice-only behaviour for
  Writing/Speaking and the client gating that consumes `/api/health` capabilities. Decisions locked with
  the user: practice-only online (no AI/transcription in the cloud), single user.
