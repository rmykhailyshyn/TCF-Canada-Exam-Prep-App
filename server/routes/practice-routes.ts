import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../lib/errors";
import { fail, ok } from "../lib/envelope";
import {
  completeWritingSessionUnscored,
  lockResponse,
} from "../services/writing";
import {
  completeSpeakingSessionUnscored,
  storeRecording,
} from "../services/speaking";
import { requireText, writingSessionId, writingTaskNumber } from "./writing";
import { speakingSessionId, speakingTaskNumber } from "./speaking";
import { type AppVars, errorResponse, readBody } from "./app-vars";

// spec: docs/specs/content-deploy.md §Behaviour.4, 5, 7; §Scope (online practice-only behaviour)
// The PRACTICE-ONLY route extension, layered onto the root app ONLY by the Worker entry
// (server/worker.ts). It re-exposes the writing/speaking submit + complete + recording-upload paths the
// Node entry registers with CLI scoring (routes/node-routes.ts), but here they LOCK / STORE / FINALISE
// WITHOUT any Claude/Whisper step — they import only the portable services, so the Worker bundle stays
// free of `node:child_process` / `node:fs`. Correction (training-only) and speaking submit (no
// transcript to score) are deliberately NOT mounted: they fall through to the Worker's NOT_FOUND
// catch-all and the client hides their buttons when capabilities are off.
//
// Body limits mirror the Node extension: 1 MB on the writing essay, ~50 MB on the speaking upload.

const ONE_MB = 1024 * 1024;
const FIFTY_MB = 50 * 1024 * 1024;

const tooLarge = (limit: number) => (c: Context) =>
  c.json(
    fail("PAYLOAD_TOO_LARGE", `Request body exceeds ${limit} bytes.`),
    413,
  );

// Registered on a bindings-free sub-app (server/worker.ts) that is then mounted on the Worker root, so
// the handlers see `Variables: AppVars` (db/mediaStore set by the root middleware propagate into the
// mounted sub-app's context, exactly as the portable core relies on).
export function registerPracticeRoutes(
  app: Hono<{ Variables: AppVars }>,
): void {
  // spec: docs/specs/content-deploy.md §Behaviour.4 — online writing submit: lock the draft, no score.
  app.post(
    "/api/writing/sessions/:id/responses/:taskNumber/submit",
    bodyLimit({ maxSize: ONE_MB, onError: tooLarge(ONE_MB) }),
    async (c) => {
      try {
        const body = await readBody(c);
        const lock = await lockResponse(
          c.get("db"),
          writingSessionId(c.req.param("id")),
          writingTaskNumber(c.req.param("taskNumber")),
          requireText(body),
        );
        // The client renders the sample answer instead of a /20: no evaluation payload.
        return c.json(
          ok({ ...lock, score: null, level: null, feedback: null }),
        );
      } catch (error) {
        return errorResponse(error, c);
      }
    },
  );

  // spec: docs/specs/content-deploy.md §Behaviour.7 — online writing complete: finalise, unscored.
  app.post("/api/writing/sessions/:id/complete", async (c) => {
    try {
      const body = await readBody(c);
      const elapsedMs = Number.isInteger(body.elapsedMs)
        ? (body.elapsedMs as number)
        : null;
      return c.json(
        ok(
          await completeWritingSessionUnscored(
            c.get("db"),
            writingSessionId(c.req.param("id")),
            elapsedMs,
          ),
        ),
      );
    } catch (error) {
      return errorResponse(error, c);
    }
  });

  // spec: docs/specs/content-deploy.md §Behaviour.5 — online speaking upload: store audio, no Whisper.
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
        const buf = new Uint8Array(await blob.arrayBuffer());
        if (buf.length === 0) {
          throw new ApiError(
            "BAD_REQUEST",
            'An "audio" file part is required.',
          );
        }
        return c.json(
          ok(
            await storeRecording(
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

  // spec: docs/specs/content-deploy.md §Behaviour.7 — online speaking complete: finalise, unscored.
  app.post("/api/speaking/sessions/:id/complete", async (c) => {
    try {
      const body = await readBody(c);
      const elapsedMs = Number.isInteger(body.elapsedMs)
        ? (body.elapsedMs as number)
        : null;
      return c.json(
        ok(
          await completeSpeakingSessionUnscored(
            c.get("db"),
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
