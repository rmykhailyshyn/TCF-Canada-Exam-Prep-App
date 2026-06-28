# Security Policy

## Scope

TCF Canada Exam Prep App is a **local-first, single-user self-study tool**. There is no
hosted multi-tenant service and no authentication layer. The optional online instance
(a single Cloudflare Worker) is **practice-only** and is expected to sit behind
**Cloudflare Access** (or a shared-secret header) — see the "Cloudflare deployment"
section of `CLAUDE.md`. Treat the local pipelines (Whisper / Tesseract / the local
Claude CLI) as trusted local tooling, not network-exposed surfaces.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for a
vulnerability.

- Preferred: open a private advisory via the repository's **Security → Report a
  vulnerability** (GitHub Security Advisories).
- Alternatively: email the maintainer at the address on their GitHub profile.

Include what you found, how to reproduce it, and the potential impact. You can expect an
acknowledgement within about a week, and we'll keep you updated as the issue is
investigated and resolved.

## Supported versions

This is an actively developed personal project; only the latest `main` is supported.
Fixes are applied to `main` rather than backported.
