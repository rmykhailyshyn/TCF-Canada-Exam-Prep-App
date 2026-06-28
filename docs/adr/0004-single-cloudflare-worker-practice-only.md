# ADR 0004: Single Cloudflare Worker, practice-only online

- Status: accepted
- Date: 2026-06-27

## Context

The app should be reachable from anywhere for **practice**, without giving up the
local-first design or running paid infrastructure. The AI/ML pipelines depend on local
CLI binaries (see [ADR-0003](0003-local-cli-tooling-over-cloud-apis.md)) that cannot run
in a serverless edge environment, and there is no user-accounts/auth layer to protect a
public endpoint.

## Decision

Host the app as a **single Cloudflare Worker** on the free tier, serving the built SPA
(Workers Static Assets) plus the Hono `/api/*` portable core, bound to **D1** (data) and
**R2** (media), and gated by **Cloudflare Access**.

- The online instance is **practice-only**: `GET /api/health` reports `capabilities` all
  `false`, and the CLI-backed routes (imports, AI scoring, transcription, correction,
  enrichment) are never mounted. The client hides those affordances and fails safe to the
  most-restrictive capabilities if `/api/health` is unreachable.
- Content is authored locally and pushed to the cloud (import locally → deploy), not
  produced online.
- Access control is **Cloudflare Access** by default (no app code); a shared-secret header
  (`ACCESS_SHARED_SECRET`) is the documented fallback when Access is not used.
- Local development (`npm run dev`) is unaffected and remains the full-capability
  environment.

## Consequences

- Free, globally reachable practice with no server to operate and study data still
  authored locally.
- A real split between the **portable core** (runs on Node locally and on the Worker) and
  the **local-only** CLI services — enforced so Worker code never imports a CLI wrapper.
- Two runtime profiles to keep in sync (local full vs online practice-only); the
  `capabilities` flag is the single switch that drives both server mounting and client UI.
- D1/R2 free-tier limits are ample for a single user but become a conscious constraint if
  usage ever grows.
