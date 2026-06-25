import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/errors";
import { fail, ok } from "../lib/envelope";
import {
  type CreateWritingSessionInput,
  completeWritingSession,
  createWritingSession,
  getWritingSession,
  requestCorrection,
  saveDraft,
  submitResponse,
} from "../services/writing";

// spec: docs/specs/writing-session.md §API contract
// Thin route layer: validate input, call the service, wrap in the { data, error } envelope.

export const writingRouter = Router();

const MODES = ["learning", "real"] as const;

function handle(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json(fail(error.code, error.message));
    return;
  }
  console.error("Unexpected error in writing route:", error);
  res.status(500).json(fail("INTERNAL", "An unexpected error occurred."));
}

function sessionId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id))
    throw new ApiError("BAD_REQUEST", "Invalid session id.");
  return id;
}

function taskNumber(req: Request): number {
  const n = Number(req.params.taskNumber);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new ApiError("BAD_REQUEST", "taskNumber must be 1, 2, or 3.");
  }
  return n;
}

function requireText(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.text !== "string")
    throw new ApiError("BAD_REQUEST", "text must be a string.");
  return body.text;
}

writingRouter.post("/sessions", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
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
    res.json(ok(await createWritingSession(input)));
  } catch (error) {
    handle(res, error);
  }
});

writingRouter.get("/sessions/:id", async (req: Request, res: Response) => {
  try {
    res.json(ok(await getWritingSession(sessionId(req))));
  } catch (error) {
    handle(res, error);
  }
});

writingRouter.put(
  "/sessions/:id/responses/:taskNumber",
  async (req: Request, res: Response) => {
    try {
      res.json(
        ok(await saveDraft(sessionId(req), taskNumber(req), requireText(req))),
      );
    } catch (error) {
      handle(res, error);
    }
  },
);

writingRouter.post(
  "/sessions/:id/responses/:taskNumber/submit",
  async (req: Request, res: Response) => {
    try {
      res.json(
        ok(
          await submitResponse(
            sessionId(req),
            taskNumber(req),
            requireText(req),
          ),
        ),
      );
    } catch (error) {
      handle(res, error);
    }
  },
);

writingRouter.post(
  "/sessions/:id/correct/:taskNumber",
  async (req: Request, res: Response) => {
    try {
      res.json(
        ok(
          await requestCorrection(
            sessionId(req),
            taskNumber(req),
            requireText(req),
          ),
        ),
      );
    } catch (error) {
      handle(res, error);
    }
  },
);

writingRouter.post(
  "/sessions/:id/complete",
  async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const elapsedMs = Number.isInteger(body.elapsedMs)
        ? (body.elapsedMs as number)
        : null;
      res.json(ok(await completeWritingSession(sessionId(req), elapsedMs)));
    } catch (error) {
      handle(res, error);
    }
  },
);
