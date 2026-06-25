import { createReadStream, existsSync, statSync } from "node:fs";
import { Router, type Request, type Response } from "express";
import { ApiError } from "../lib/errors";
import { fail, ok } from "../lib/envelope";
import {
  parseDifficultyFilter,
  parseSectionFilter,
} from "../lib/export-import";
import { exportQuestions, importQuestions } from "../services/export-import";
import {
  getAudioFile,
  getPassageImage,
  getTranscript,
} from "../services/questions";

export const questionsRouter = Router();

// Maps thrown ApiErrors onto the standard failure envelope; anything else becomes a 500.
function handle(res: Response, error: unknown): void {
  if (error instanceof ApiError) {
    res.status(error.status).json(fail(error.code, error.message));
    return;
  }
  console.error("Unexpected error in questions route:", error);
  res.status(500).json(fail("INTERNAL", "An unexpected error occurred."));
}

// spec: docs/specs/question-export-import.md §API contract GET /api/questions/export
// Returns the filtered export document. Registered before the `:id` routes so the literal
// `export` / `import` paths are not swallowed by the param matcher.
questionsRouter.get("/export", async (req: Request, res: Response) => {
  try {
    const section = parseSectionFilter(
      typeof req.query.section === "string" ? req.query.section : undefined,
    );
    const difficulty = parseDifficultyFilter(
      typeof req.query.difficulty === "string"
        ? req.query.difficulty
        : undefined,
    );
    const document = await exportQuestions(section, difficulty);
    res.json(ok(document));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/question-export-import.md §API contract POST /api/questions/import
questionsRouter.post("/import", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as { document?: unknown; override?: unknown };
    const override = body.override === true;
    const summary = await importQuestions(body.document, override);
    res.json(ok(summary));
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio (range support)
// Parses an HTTP `Range: bytes=start-end` header against a known file size. Returns null for an
// absent/unsatisfiable header (caller serves the whole file), or the resolved byte window.
export function parseRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  const start = rawStart ? Number.parseInt(rawStart, 10) : 0;
  let end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end >= size) end = size - 1;
  if (start > end || start < 0) return null;
  return { start, end };
}

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio
// Streams the MP3 with HTTP range support so the browser <audio> element can seek. A full request
// returns 200; a ranged request returns 206 with Content-Range. Unknown id / missing file → a
// NOT_FOUND failure envelope.
questionsRouter.get("/:id/audio", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      throw new ApiError("BAD_REQUEST", "Invalid question id.");

    const { filePath } = await getAudioFile(id);
    if (!existsSync(filePath)) {
      throw new ApiError(
        "NOT_FOUND",
        `Audio file is missing on disk for question ${id}.`,
        404,
      );
    }

    const size = statSync(filePath).size;
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Accept-Ranges", "bytes");

    const range = parseRange(req.headers.range, size);
    if (req.headers.range && !range) {
      res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
      return;
    }

    if (range) {
      res.status(206);
      res.setHeader(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${size}`,
      );
      res.setHeader("Content-Length", range.end - range.start + 1);
      createReadStream(filePath, { start: range.start, end: range.end }).pipe(
        res,
      );
    } else {
      res.setHeader("Content-Length", size);
      createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    handle(res, error);
  }
});

// spec: docs/specs/reading-quiz-ui.md §API contract GET /api/questions/:id/passage-image
// Streams the original passage image so the reading UI can show it above the OCR'd text. Unknown
// id / non-reading question / file missing on disk → a PASSAGE_IMAGE_NOT_FOUND 404, which the
// client treats as "fall back to text-only" (reading-quiz-ui §Behaviour.3c). No range support —
// images are small and loaded whole by the <img> element.
questionsRouter.get(
  "/:id/passage-image",
  async (req: Request, res: Response) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id))
        throw new ApiError("BAD_REQUEST", "Invalid question id.");

      const { filePath, contentType } = await getPassageImage(id);
      if (!existsSync(filePath)) {
        throw new ApiError(
          "PASSAGE_IMAGE_NOT_FOUND",
          `Passage image is missing on disk for question ${id}.`,
          404,
        );
      }

      const size = statSync(filePath).size;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", size);
      createReadStream(filePath).pipe(res);
    } catch (error) {
      handle(res, error);
    }
  },
);

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/transcript
questionsRouter.get("/:id/transcript", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id))
      throw new ApiError("BAD_REQUEST", "Invalid question id.");
    const segments = await getTranscript(id);
    res.json(ok({ segments }));
  } catch (error) {
    handle(res, error);
  }
});
