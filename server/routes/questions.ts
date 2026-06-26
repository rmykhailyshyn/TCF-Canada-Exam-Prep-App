import { Hono } from "hono";
import { ApiError } from "../lib/errors";
import { ok } from "../lib/envelope";
import {
  parseDifficultyFilter,
  parseSectionFilter,
} from "../lib/export-import";
import { exportQuestions } from "../services/export-import";
import {
  getAudioFile,
  getPassageImage,
  getTranscript,
} from "../services/questions";
import { type AppVars, errorResponse, serveMedia } from "./app-vars";

// spec: docs/specs/question-export-import.md + docs/specs/listening-player.md §API contract
// PORTABLE read endpoints only: export (DB), audio/passage-image (streamed via the MediaStore with
// range support), and transcript. POST /api/questions/import is CLI/fs-adjacent and registered by the
// Node entry (routes/node-routes.ts). spec: docs/specs/server-runtime.md §Behaviour.6, 8
export const questionsRouter = new Hono<{ Variables: AppVars }>();

questionsRouter.onError(errorResponse);

function questionId(idParam: string): number {
  const id = Number(idParam);
  if (!Number.isInteger(id))
    throw new ApiError("BAD_REQUEST", "Invalid question id.");
  return id;
}

// spec: docs/specs/question-export-import.md §API contract GET /api/questions/export
// Registered before the `:id` routes so the literal `export` path is not swallowed by the param
// matcher.
questionsRouter.get("/export", async (c) => {
  const section = parseSectionFilter(c.req.query("section"));
  const difficulty = parseDifficultyFilter(c.req.query("difficulty"));
  const document = await exportQuestions(c.get("db"), section, difficulty);
  return c.json(ok(document));
});

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/audio
// Streams the MP3 with HTTP range support so the browser <audio> element can seek. Unknown id /
// missing file → a NOT_FOUND failure envelope.
questionsRouter.get("/:id/audio", async (c) => {
  const id = questionId(c.req.param("id"));
  const { key } = await getAudioFile(c.get("db"), id);
  return serveMedia(c, key, "audio/mpeg", {
    rangeable: true,
    missing: () => {
      throw new ApiError(
        "NOT_FOUND",
        `Audio file is missing on disk for question ${id}.`,
        404,
      );
    },
  });
});

// spec: docs/specs/reading-quiz-ui.md §API contract GET /api/questions/:id/passage-image
// Streams the original passage image (no range — images are small and loaded whole). Unknown id /
// non-reading question / file missing → a PASSAGE_IMAGE_NOT_FOUND 404 (client falls back to text).
questionsRouter.get("/:id/passage-image", async (c) => {
  const id = questionId(c.req.param("id"));
  const { key, contentType } = await getPassageImage(c.get("db"), id);
  return serveMedia(c, key, contentType, {
    rangeable: false,
    missing: () => {
      throw new ApiError(
        "PASSAGE_IMAGE_NOT_FOUND",
        `Passage image is missing on disk for question ${id}.`,
        404,
      );
    },
  });
});

// spec: docs/specs/listening-player.md §API contract GET /api/questions/:id/transcript
questionsRouter.get("/:id/transcript", async (c) => {
  const id = questionId(c.req.param("id"));
  const segments = await getTranscript(c.get("db"), id);
  return c.json(ok({ segments }));
});
