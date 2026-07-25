import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../lib/errors";
import { fail, ok } from "../lib/envelope";
import { importQuestions } from "../services/export-import";
import {
  completeWritingSession,
  requestCorrection as writingRequestCorrection,
  submitResponse as writingSubmitResponse,
} from "../services/writing-scoring";
import {
  completeSpeakingSession,
  requestCorrection as speakingRequestCorrection,
  saveRecording,
  submitResponse as speakingSubmitResponse,
} from "../services/speaking-node";
import { requireText, writingSessionId, writingTaskNumber } from "./writing";
import { speakingSessionId, speakingTaskNumber } from "./speaking";
import { type AppVars, errorResponse, readBody } from "./app-vars";

// spec: docs/specs/server-runtime.md §Behaviour.8; §Scope (Node-only extension)
// The CLI-backed routes, layered onto the root app ONLY by the Node entry: question import (fs-aware)
// and the writing/speaking scoring + correction + completion + recording-upload paths (Claude/Whisper
// via child_process). Keeping them out of the portable core (server/app.ts) guarantees the future
// Worker bundle never pulls in `node:child_process` / `node:fs`.
//
// Body limits mirror the previous Express setup: a 1 MB JSON limit on the writing essay routes and a
// ~50 MB cap on the multipart speaking upload (replacing multer). The bodyLimit onError returns the
// project failure envelope. spec: docs/specs/server-runtime.md §Behaviour.3

const ONE_MB = 1024 * 1024;
const FIFTY_MB = 50 * 1024 * 1024;

const tooLarge = (limit: number) => (c: Context) =>
  c.json(
    fail("PAYLOAD_TOO_LARGE", `Request body exceeds ${limit} bytes.`),
    413,
  );

// spec: docs/specs/llm-provider.md §Behaviour.1 — the Node entry always injects an `llm` (CLI or API
// provider, per config); its absence here would be a wiring bug, not a runtime condition to handle.
function requireLlm(c: Context<{ Variables: AppVars }>) {
  const llm = c.get("llm");
  if (!llm) throw new ApiError("INTERNAL", "No LLM provider configured.", 500);
  return llm;
}

export function registerNodeRoutes(app: Hono<{ Variables: AppVars }>): void {
  // spec: docs/specs/question-export-import.md §API contract POST /api/questions/import
  app.post(
    "/api/questions/import",
    bodyLimit({ maxSize: FIFTY_MB, onError: tooLarge(FIFTY_MB) }),
    async (c) => {
      try {
        const body = (await readBody(c)) as {
          document?: unknown;
          override?: unknown;
        };
        const override = body.override === true;
        const summary = await importQuestions(
          c.get("db"),
          c.get("mediaStore"),
          body.document,
          override,
        );
        return c.json(ok(summary));
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  );

  // spec: docs/specs/writing-session.md §API contract — submit (Claude scoring).
  app.post(
    "/api/writing/sessions/:id/responses/:taskNumber/submit",
    bodyLimit({ maxSize: ONE_MB, onError: tooLarge(ONE_MB) }),
    async (c) => {
      try {
        const body = await readBody(c);
        const { provider, config } = requireLlm(c);
        return c.json(
          ok(
            await writingSubmitResponse(
              c.get("db"),
              provider,
              config,
              writingSessionId(c.req.param("id")),
              writingTaskNumber(c.req.param("taskNumber")),
              requireText(body),
            ),
          ),
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  );

  // spec: docs/specs/writing-session.md §API contract — correction (training only).
  app.post(
    "/api/writing/sessions/:id/correct/:taskNumber",
    bodyLimit({ maxSize: ONE_MB, onError: tooLarge(ONE_MB) }),
    async (c) => {
      try {
        const body = await readBody(c);
        const { provider } = requireLlm(c);
        return c.json(
          ok(
            await writingRequestCorrection(
              c.get("db"),
              provider,
              writingSessionId(c.req.param("id")),
              writingTaskNumber(c.req.param("taskNumber")),
              requireText(body),
            ),
          ),
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  );

  // spec: docs/specs/writing-session.md §API contract — complete + aggregate.
  app.post("/api/writing/sessions/:id/complete", async (c) => {
    try {
      const body = await readBody(c);
      const elapsedMs = Number.isInteger(body.elapsedMs)
        ? (body.elapsedMs as number)
        : null;
      const { provider, config } = requireLlm(c);
      return c.json(
        ok(
          await completeWritingSession(
            c.get("db"),
            provider,
            config,
            writingSessionId(c.req.param("id")),
            elapsedMs,
          ),
        ),
      );
    } catch (error) {
      return errorResponse(error, c);
    }
  });

  // spec: docs/specs/speaking-session.md §API contract — upload a recording (Whisper transcription).
  app.post(
    "/api/speaking/sessions/:id/responses/:taskNumber",
    bodyLimit({ maxSize: FIFTY_MB, onError: tooLarge(FIFTY_MB) }),
    async (c) => {
      try {
        const form = await c.req.parseBody();
        const file = form["audio"];
        if (!file || typeof file === "string") {
          throw new ApiError(
            "BAD_REQUEST",
            'An "audio" file part is required.',
          );
        }
        const blob = file as File;
        const buf = Buffer.from(await blob.arrayBuffer());
        if (buf.length === 0) {
          throw new ApiError(
            "BAD_REQUEST",
            'An "audio" file part is required.',
          );
        }
        return c.json(
          ok(
            await saveRecording(
              c.get("db"),
              c.get("mediaStore"),
              speakingSessionId(c.req.param("id")),
              speakingTaskNumber(c.req.param("taskNumber")),
              buf,
              blob.type,
            ),
          ),
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  );

  // spec: docs/specs/speaking-session.md §API contract — submit (Claude scoring).
  app.post(
    "/api/speaking/sessions/:id/responses/:taskNumber/submit",
    async (c) => {
      try {
        const { provider, config } = requireLlm(c);
        return c.json(
          ok(
            await speakingSubmitResponse(
              c.get("db"),
              provider,
              config,
              speakingSessionId(c.req.param("id")),
              speakingTaskNumber(c.req.param("taskNumber")),
            ),
          ),
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  );

  // spec: docs/specs/speaking-session.md §API contract — correction (training only).
  app.post("/api/speaking/sessions/:id/correct/:taskNumber", async (c) => {
    try {
      const { provider } = requireLlm(c);
      return c.json(
        ok(
          await speakingRequestCorrection(
            c.get("db"),
            provider,
            speakingSessionId(c.req.param("id")),
            speakingTaskNumber(c.req.param("taskNumber")),
          ),
        ),
      );
    } catch (error) {
      return errorResponse(error, c);
    }
  });

  // spec: docs/specs/speaking-session.md §API contract — complete + aggregate.
  app.post("/api/speaking/sessions/:id/complete", async (c) => {
    try {
      const body = await readBody(c);
      const elapsedMs = Number.isInteger(body.elapsedMs)
        ? (body.elapsedMs as number)
        : null;
      const { provider, config } = requireLlm(c);
      return c.json(
        ok(
          await completeSpeakingSession(
            c.get("db"),
            provider,
            config,
            speakingSessionId(c.req.param("id")),
            elapsedMs,
          ),
        ),
      );
    } catch (error) {
      return errorResponse(error, c);
    }
  });
}
