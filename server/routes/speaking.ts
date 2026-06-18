import { createReadStream, existsSync, statSync } from 'node:fs';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { ApiError } from '../lib/errors';
import { fail, ok } from '../lib/envelope';
import {
  type CreateSpeakingSessionInput,
  completeSpeakingSession,
  createSpeakingSession,
  getResponseAudioPath,
  getSpeakingSession,
  requestCorrection,
  saveRecording,
  submitResponse,
} from '../services/speaking';
import { parseRange } from './questions';

// spec: docs/specs/speaking-session.md §API contract
// Thin route layer: validate input, call the service, wrap in the { data, error } envelope. The
// recording-upload route uses multer (in-memory) to receive the multipart audio blob; everything
// else is JSON. Audio playback streams with HTTP range support (reusing parseRange) so the browser
// <audio> element can seek, mirroring the listening player's /audio route.

export const speakingRouter = Router();

// Recordings are short (≤ ~5 min); buffer them in memory, then the service writes to MEDIA_DIR.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const MODES = ['learning', 'real'] as const;

function handle(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json(fail(error.code, error.message));
    return;
  }
  console.error('Unexpected error in speaking route:', error);
  res.status(500).json(fail('INTERNAL', 'An unexpected error occurred.'));
}

function sessionId(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw new ApiError('BAD_REQUEST', 'Invalid session id.');
  return id;
}

function taskNumber(req: Request): number {
  const n = Number(req.params.taskNumber);
  if (!Number.isInteger(n) || n < 1 || n > 3) {
    throw new ApiError('BAD_REQUEST', 'taskNumber must be 1, 2, or 3.');
  }
  return n;
}

// spec: docs/specs/speaking-session.md §API contract POST /api/speaking/sessions
speakingRouter.post('/sessions', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!MODES.includes(body.mode as (typeof MODES)[number])) {
      throw new ApiError('INVALID_MODE', 'mode must be "learning" or "real".');
    }
    const input: CreateSpeakingSessionInput = {
      mode: body.mode as CreateSpeakingSessionInput['mode'],
    };
    if (Array.isArray(body.taskNumbers)) {
      if (!body.taskNumbers.every((n) => Number.isInteger(n))) {
        throw new ApiError('BAD_REQUEST', 'taskNumbers must be an array of integers.');
      }
      input.taskNumbers = body.taskNumbers as number[];
    }
    res.json(ok(await createSpeakingSession(input)));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/speaking-session.md §API contract GET /api/speaking/sessions/:id
speakingRouter.get('/sessions/:id', async (req: Request, res: Response) => {
  try {
    res.json(ok(await getSpeakingSession(sessionId(req))));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/speaking-session.md §API contract POST …/responses/:taskNumber — upload recording.
speakingRouter.post(
  '/sessions/:id/responses/:taskNumber',
  upload.single('audio'),
  async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file || !file.buffer || file.buffer.length === 0) {
        throw new ApiError('BAD_REQUEST', 'An "audio" file part is required.');
      }
      res.json(
        ok(await saveRecording(sessionId(req), taskNumber(req), file.buffer, file.mimetype)),
      );
    } catch (error) {
      handle(res, error);
    }
  },
);

// spec: docs/specs/speaking-session.md §API contract POST …/responses/:taskNumber/submit
speakingRouter.post(
  '/sessions/:id/responses/:taskNumber/submit',
  async (req: Request, res: Response) => {
    try {
      res.json(ok(await submitResponse(sessionId(req), taskNumber(req))));
    } catch (error) {
      handle(res, error);
    }
  },
);

// spec: docs/specs/speaking-session.md §API contract POST …/correct/:taskNumber (training only)
speakingRouter.post('/sessions/:id/correct/:taskNumber', async (req: Request, res: Response) => {
  try {
    res.json(ok(await requestCorrection(sessionId(req), taskNumber(req))));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/speaking-session.md §API contract POST /api/speaking/sessions/:id/complete
speakingRouter.post('/sessions/:id/complete', async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const elapsedMs = Number.isInteger(body.elapsedMs) ? (body.elapsedMs as number) : null;
    res.json(ok(await completeSpeakingSession(sessionId(req), elapsedMs)));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/speaking-session.md §API contract GET …/responses/:taskNumber/audio
// Streams the saved recording with HTTP range support so the review UI's <audio> element can seek.
// A full request returns 200; a ranged request returns 206 with Content-Range. Missing file →
// NOT_FOUND failure envelope.
speakingRouter.get(
  '/sessions/:id/responses/:taskNumber/audio',
  async (req: Request, res: Response) => {
    try {
      const { filePath, contentType } = await getResponseAudioPath(sessionId(req), taskNumber(req));
      if (!existsSync(filePath)) {
        throw new ApiError('NOT_FOUND', 'Recording file is missing on disk.', 404);
      }

      const size = statSync(filePath).size;
      res.setHeader('Content-Type', contentType);
      res.setHeader('Accept-Ranges', 'bytes');

      const range = parseRange(req.headers.range, size);
      if (req.headers.range && !range) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }

      if (range) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader('Content-Length', range.end - range.start + 1);
        createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
      } else {
        res.setHeader('Content-Length', size);
        createReadStream(filePath).pipe(res);
      }
    } catch (error) {
      handle(res, error);
    }
  },
);
