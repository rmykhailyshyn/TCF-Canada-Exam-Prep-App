import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError } from "../lib/errors";
import { ok, fail } from "../lib/envelope";
import {
  type CreateWritingSessionInput,
  createWritingSession,
  getWritingSession,
  saveDraft,
} from "../services/writing";
import { type AppVars, errorResponse, readBody } from "./app-vars";

// spec: docs/specs/writing-session.md §API contract
// PORTABLE writing endpoints: create a session, read it back, autosave a draft. The CLI-backed
// submit / correct / complete (Claude scoring) are registered by the Node entry
// (routes/node-routes.ts). spec: docs/specs/server-runtime.md §Behaviour.8
export const writingRouter = new Hono<{ Variables: AppVars }>();

writingRouter.onError(errorResponse);

// Mirror the 1 MB JSON limit that Express applied globally. spec: docs/specs/server-runtime.md §Behaviour.3
const ONE_MB = 1024 * 1024;

const MODES = ["learning", "real"] as const;

export function writingSessionId(idParam: string): number {
  const id = Number(idParam);
  if (!Number.isInteger(id))
    throw new ApiError("BAD_REQUEST", "Invalid session id.");
  return id;
}

export function writingTaskNumber(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new ApiError("BAD_REQUEST", "taskNumber must be 1, 2, or 3.");
  }
  return n;
}

export function requireText(body: Record<string, unknown>): string {
  if (typeof body.text !== "string")
    throw new ApiError("BAD_REQUEST", "text must be a string.");
  return body.text;
}

writingRouter.post("/sessions", async (c) => {
  const body = await readBody(c);
  if (!MODES.includes(body.mode as (typeof MODES)[number])) {
    throw new ApiError("BAD_REQUEST", 'mode must be "learning" or "real".');
  }
  const input: CreateWritingSessionInput = {
    mode: body.mode as CreateWritingSessionInput["mode"],
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
  return c.json(ok(await createWritingSession(c.get("db"), input)));
});

writingRouter.get("/sessions/:id", async (c) => {
  return c.json(
    ok(
      await getWritingSession(c.get("db"), writingSessionId(c.req.param("id"))),
    ),
  );
});

writingRouter.put(
  "/sessions/:id/responses/:taskNumber",
  bodyLimit({
    maxSize: ONE_MB,
    onError: (c) =>
      c.json(fail("PAYLOAD_TOO_LARGE", "Request body exceeds 1 MB."), 413),
  }),
  async (c) => {
    const body = await readBody(c);
    return c.json(
      ok(
        await saveDraft(
          c.get("db"),
          writingSessionId(c.req.param("id")),
          writingTaskNumber(c.req.param("taskNumber")),
          requireText(body),
        ),
      ),
    );
  },
);
