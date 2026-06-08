import { Router, type Request, type Response } from 'express';
import { ApiError } from '../lib/errors';
import { fail, ok } from '../lib/envelope';
import {
  type CreateSessionInput,
  type OptionLabel,
  completeSession,
  createSession,
  recordAnswer,
} from '../services/sessions';

export const sessionsRouter = Router();

const SECTIONS = ['reading', 'listening'] as const;
const MODES = ['learning', 'real'] as const;
const LABELS = ['A', 'B', 'C', 'D'] as const;

// Maps thrown ApiErrors onto the standard failure envelope; anything else becomes a 500.
function handle(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json(fail(error.code, error.message));
    return;
  }
  console.error('Unexpected error in sessions route:', error);
  res.status(500).json(fail('INTERNAL', 'An unexpected error occurred.'));
}

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions
sessionsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    if (!SECTIONS.includes(body.section as (typeof SECTIONS)[number])) {
      throw new ApiError('BAD_REQUEST', 'section must be "reading" or "listening".');
    }
    if (!MODES.includes(body.mode as (typeof MODES)[number])) {
      throw new ApiError('BAD_REQUEST', 'mode must be "learning" or "real".');
    }

    const input: CreateSessionInput = {
      section: body.section as CreateSessionInput['section'],
      mode: body.mode as CreateSessionInput['mode'],
    };
    if (typeof body.difficulty === 'string') {
      input.difficulty = body.difficulty as CreateSessionInput['difficulty'];
    }
    if (Array.isArray(body.questionIds)) {
      if (!body.questionIds.every((id) => Number.isInteger(id))) {
        throw new ApiError('BAD_REQUEST', 'questionIds must be an array of integers.');
      }
      input.questionIds = body.questionIds as number[];
    }

    const result = await createSession(input);
    res.json(ok(result));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/answers
sessionsRouter.post('/:id/answers', async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      throw new ApiError('BAD_REQUEST', 'Invalid session id.');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(body.questionId)) {
      throw new ApiError('BAD_REQUEST', 'questionId must be an integer.');
    }
    if (!LABELS.includes(body.chosenLabel as (typeof LABELS)[number])) {
      throw new ApiError('BAD_REQUEST', 'chosenLabel must be one of A, B, C, D.');
    }

    const result = await recordAnswer(
      sessionId,
      body.questionId as number,
      body.chosenLabel as OptionLabel,
    );

    if (result.mode === 'learning') {
      res.json(
        ok({
          isCorrect: result.isCorrect,
          correctLabel: result.correctLabel,
          explanation: result.explanation,
        }),
      );
    } else {
      res.json(ok({ recorded: true }));
    }
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/quiz-session.md §API contract POST /api/sessions/:id/complete
sessionsRouter.post('/:id/complete', async (req: Request, res: Response) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId)) {
      throw new ApiError('BAD_REQUEST', 'Invalid session id.');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const elapsedMs =
      body.elapsedMs == null
        ? null
        : Number.isInteger(body.elapsedMs)
          ? (body.elapsedMs as number)
          : null;

    const result = await completeSession(sessionId, elapsedMs);
    res.json(ok(result));
  } catch (error) {
    handle(res, error);
  }
});
