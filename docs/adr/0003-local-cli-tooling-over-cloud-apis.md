# ADR 0003: Local CLI tooling (Whisper / Tesseract / Claude CLI) over cloud APIs

- Status: accepted
- Date: 2026-06-27

## Context

Building the question bank and grading responses needs three AI/ML capabilities: audio
transcription (listening import, speaking grading), OCR (reading passage import), and
LLM text generation (English explanations, writing/speaking scoring and correction). The
obvious path is hosted cloud APIs, but that introduces API keys, per-call cost, network
dependence, and sending study material to third parties — at odds with the local-first,
no-auth, no-cloud-services posture of the app.

## Decision

Use **local command-line tools** for all AI/ML work, wrapped behind `scripts/` and
`server/services/`:

- **Audio transcription** — the local Whisper CLI (`mlx-whisper` / `whisper.cpp`).
- **OCR** — Tesseract CLI.
- **LLM enrichment, writing/speaking scoring & correction** — the local Claude CLI
  (`claude` on `PATH`), configured via `CLAUDE_CLI_BIN` / `CLAUDE_CLI_MODEL`; no API key.

Conventions: CLI calls are never inlined in route handlers; non-zero exit codes are
handled explicitly and stderr is logged. The Whisper/Tesseract pipelines require Apple
Silicon and may only be invoked on macOS — that OS-specific logic is confined to the
`scripts/` and `server/services/` wrappers and never leaks into `client/` or the portable
server core.

Derived scores (e.g. NCLC level) are computed deterministically in code
(`server/lib/nclc.ts`), never produced by the model.

## Consequences

- No API keys, no per-call cost, no study data leaving the machine.
- The import and grading pipelines are platform-constrained (Apple Silicon / macOS) and
  cannot run in CI or on the Cloudflare Worker — which is precisely why the online instance
  is practice-only (see [ADR-0004](0004-single-cloudflare-worker-practice-only.md)).
- Output quality depends on locally available models rather than a managed service.
- Confining OS-specific code to the wrapper layer keeps the frontend and portable server
  core cross-platform and Worker-ready.
