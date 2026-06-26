import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { ok } from "../lib/envelope";
import {
  type CreateSpeakingSessionInput,
  createSpeakingSession,
  getResponseAudioKey,
  getSpeakingSession,
} from "../services/speaking";
import { type AppVars, errorResponse, readBody, serveMedia } from "./app-vars";

// spec: docs/specs/speaking-session.md §API contract
// PORTABLE speaking endpoints: create a session, read it back, stream a saved recording (range
// support, via the MediaStore). The recording upload (Whisper transcription), submit, correct, and
// complete (Claude scoring) are CLI-backed and registered by the Node entry (routes/node-routes.ts).
// spec: docs/specs/server-runtime.md §Behaviour.6, 8
export const speakingRouter = new Hono<{ Variables: AppVars }>();

speakingRouter.onError(errorResponse);

const MODES = ["learning", "real"] as const;

export function speakingSessionId(idParam: string): number {
  const id = Number(idParam);
  if (!Number.isInteger(id))
    throw new ApiError("BAD_REQUEST", "Invalid session id.");
  return id;
}

export function speakingTaskNumber(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new ApiError("BAD_REQUEST", "taskNumber must be 1, 2, or 3.");
  }
  return n;
}

// spec: docs/specs/speaking-session.md §API contract POST /api/speaking/sessions
speakingRouter.post("/sessions", async (c) => {
  const body = await readBody(c);
  if (!MODES.includes(body.mode as (typeof MODES)[number])) {
    throw new ApiError("INVALID_MODE", 'mode must be "learning" or "real".');
  }
  const input: CreateSpeakingSessionInput = {
    mode: body.mode as CreateSpeakingSessionInput["mode"],
  };
  if (Array.isArray(body.taskNumbers)) {
    if (!body.taskNumbers.every((n) => Number.isInteger(n))) {
      throw new ApiError(
        "BAD_REQUEST",
        "taskNumbers must be an array of integers.",
      );
    }
    input.taskNumbers = body.taskNumbers as number[];
  }
  return c.json(ok(await createSpeakingSession(c.get("db"), input)));
});

// spec: docs/specs/speaking-session.md §API contract GET /api/speaking/sessions/:id
speakingRouter.get("/sessions/:id", async (c) => {
  return c.json(
    ok(
      await getSpeakingSession(
        c.get("db"),
        speakingSessionId(c.req.param("id")),
      ),
    ),
  );
});

// spec: docs/specs/speaking-session.md §API contract GET …/responses/:taskNumber/audio
// Streams the saved recording with HTTP range support so the review UI's <audio> element can seek.
// Missing file → NOT_FOUND failure envelope.
speakingRouter.get("/sessions/:id/responses/:taskNumber/audio", async (c) => {
  const { key, contentType } = await getResponseAudioKey(
    c.get("db"),
    speakingSessionId(c.req.param("id")),
    speakingTaskNumber(c.req.param("taskNumber")),
  );
  return serveMedia(c, key, contentType, {
    rangeable: true,
    missing: () => {
      throw new ApiError(
        "NOT_FOUND",
        "Recording file is missing on disk.",
        404,
      );
    },
  });
});
