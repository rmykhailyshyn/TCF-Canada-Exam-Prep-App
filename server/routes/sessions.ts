import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { ok } from "../lib/envelope";
import {
  type CreateSessionInput,
  type OptionLabel,
  completeSession,
  createSession,
  getSession,
  listSessions,
  recordAnswer,
} from "../services/sessions";
import { type AppVars, errorResponse, readBody } from "./app-vars";

// spec: docs/specs/quiz-session.md + docs/specs/progress-tracking.md §API contract
// Thin route layer: validate input, call the service (passing the injected DB), wrap in the envelope.
export const sessionsRouter = new Hono<{ Variables: AppVars }>();

sessionsRouter.onError(errorResponse);

const SECTIONS = ["reading", "listening"] as const;
const MODES = ["learning", "real"] as const;
const LABELS = ["A", "B", "C", "D"] as const;

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions
sessionsRouter.get("/", async (c) => {
  const sessions = await listSessions(c.get("db"));
  return c.json(ok({ sessions }));
});

// spec: docs/specs/progress-tracking.md §API contract GET /api/sessions/:id
sessionsRouter.get("/:id", async (c) => {
  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) {
    throw new ApiError("BAD_REQUEST", "Invalid session id.");
  }
  const detail = await getSession(c.get("db"), sessionId);
  return c.json(ok(detail));
});

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions
sessionsRouter.post("/", async (c) => {
  const body = await readBody(c);

  if (!SECTIONS.includes(body.section as (typeof SECTIONS)[number])) {
    throw new ApiError(
      "BAD_REQUEST",
      'section must be "reading" or "listening".',
    );
  }
  if (!MODES.includes(body.mode as (typeof MODES)[number])) {
    throw new ApiError("BAD_REQUEST", 'mode must be "learning" or "real".');
  }

  const input: CreateSessionInput = {
    section: body.section as CreateSessionInput["section"],
    mode: body.mode as CreateSessionInput["mode"],
  };
  if (typeof body.difficulty === "string") {
    input.difficulty = body.difficulty as CreateSessionInput["difficulty"];
  }
  if (Array.isArray(body.questionIds)) {
    if (!body.questionIds.every((id) => Number.isInteger(id))) {
      throw new ApiError(
        "BAD_REQUEST",
        "questionIds must be an array of integers.",
      );
    }
    input.questionIds = body.questionIds as number[];
  }

  const result = await createSession(c.get("db"), input);
  return c.json(ok(result));
});

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/answers
sessionsRouter.post("/:id/answers", async (c) => {
  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) {
    throw new ApiError("BAD_REQUEST", "Invalid session id.");
  }
  const body = await readBody(c);
  if (!Number.isInteger(body.questionId)) {
    throw new ApiError("BAD_REQUEST", "questionId must be an integer.");
  }
  if (!LABELS.includes(body.chosenLabel as (typeof LABELS)[number])) {
    throw new ApiError("BAD_REQUEST", "chosenLabel must be one of A, B, C, D.");
  }

  const result = await recordAnswer(
    c.get("db"),
    sessionId,
    body.questionId as number,
    body.chosenLabel as OptionLabel,
  );

  if (result.mode === "learning") {
    return c.json(
      ok({
        isCorrect: result.isCorrect,
        correctLabel: result.correctLabel,
        explanation: result.explanation,
      }),
    );
  }
  return c.json(ok({ recorded: true }));
});

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
sessionsRouter.post("/:id/complete", async (c) => {
  const sessionId = Number(c.req.param("id"));
  if (!Number.isInteger(sessionId)) {
    throw new ApiError("BAD_REQUEST", "Invalid session id.");
  }
  const body = await readBody(c);
  const elapsedMs =
    body.elapsedMs == null
      ? null
      : Number.isInteger(body.elapsedMs)
        ? (body.elapsedMs as number)
        : null;

  const result = await completeSession(c.get("db"), sessionId, elapsedMs);
  return c.json(ok(result));
});
