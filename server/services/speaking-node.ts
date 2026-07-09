import { asc, eq } from "drizzle-orm";
import type { DbClient } from "../db/factory";
import { sessions, speakingEvaluations, speakingResponses } from "../db/schema";
import { ApiError } from "../lib/errors";
import {
  ClaudeError,
  type LlmConfig,
  type LlmProvider,
  providerLabel,
} from "../lib/llm-provider";
import { scoreToNclc } from "../lib/nclc";
import { resolveMediaPath } from "../config/env";
import type { MediaStore } from "../runtime/media-store";
import {
  type CompleteResult,
  type SubmitResult,
  type UploadResult,
  audioKeyFor,
  audioUrlFor,
  extensionForMime,
  loadEvaluations,
  loadResponse,
  loadSession,
  loadTaskForResponse,
} from "./speaking";
import {
  type SpeakingCorrection,
  type SpeakingFeedback,
  correctWithClaude,
  scoreWithClaude,
} from "./speakingEvaluation";
import { WhisperError, transcribeFile } from "./speakingTranscription";

// spec: docs/specs/speaking-session.md; docs/specs/server-runtime.md §Behaviour.8; llm-provider.md
// Node-only speaking path: saving a recording transcribes it via the LOCAL Whisper CLI
// (`child_process`), so this module is registered only by the Node entry (routes/node-routes.ts) and
// never enters the portable core. Submit / correct / complete score through an injected LlmProvider
// (server/lib/llm-provider) — CLI or API, per Node's resolved config — but stay Node-only alongside
// the upload path rather than moving to the portable writing-scoring.ts pattern: per
// docs/specs/llm-provider.md Open Questions, Worker Speaking scoring is deferred (no transcript can
// ever exist online without transcription, which the Worker doesn't have). Audio bytes are persisted
// through the injected MediaStore (relative key); the DB is injected.
//
// Rule-4 note: the approved plan listed the recording-upload route in the portable core. Because
// preserving byte-identical behaviour requires transcribing at upload time (the client reads the
// transcript from the upload response and `submit` scores the already-stored transcript), the
// upload path stays here with Whisper. The core keeps create / get / audio-playback only.

async function persistEvaluation(
  db: DbClient,
  responseId: number,
  score: number,
  feedback: SpeakingFeedback,
  generatedBy: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(speakingEvaluations)
      .where(eq(speakingEvaluations.responseId, responseId));
    await tx.insert(speakingEvaluations).values({
      responseId,
      score,
      strengths: feedback.strengths,
      errors: feedback.errors,
      improvements: feedback.improvements,
      generatedBy,
    });
  });
}

// spec: docs/specs/speaking-session.md §Behaviour.15; speaking-evaluation §Behaviour.3–5 — save a
// recording through the MediaStore, transcribe it (Whisper), and store the draft (no scoring yet).
export async function saveRecording(
  db: DbClient,
  mediaStore: MediaStore,
  sessionId: number,
  taskNumber: number,
  audio: Buffer,
  mimetype: string | undefined,
): Promise<UploadResult> {
  await loadSession(db, sessionId);
  const row = await loadResponse(db, sessionId, taskNumber);

  const ext = extensionForMime(mimetype);
  const key = audioKeyFor(sessionId, taskNumber, ext);
  // Re-recording replaces the prior take; drop a stale stored object if its key changed.
  if (row.audioPath && row.audioPath !== key) {
    await mediaStore.delete(row.audioPath);
  }
  await mediaStore.put(
    key,
    new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength),
    `audio/${ext}`,
  );

  // Whisper reads from the filesystem; resolve the stored key to an absolute path for the CLI.
  const filePath = resolveMediaPath(key);

  let transcript: string;
  let durationMs: number | null;
  try {
    const result = transcribeFile(filePath);
    transcript = result.transcript;
    durationMs = result.durationMs;
  } catch (error) {
    if (error instanceof WhisperError) {
      // spec: speaking-evaluation §Behaviour.5 — keep the audio (stored above) for a retry.
      await db
        .update(speakingResponses)
        .set({ audioPath: key })
        .where(eq(speakingResponses.id, row.id));
      throw new ApiError(
        "TRANSCRIPTION_FAILED",
        `Could not transcribe the recording: ${error.message}`,
        502,
      );
    }
    throw error;
  }

  // A new recording invalidates any prior transcript-driven state; clear submittedAt so the user
  // re-submits the new take (re-recording replaces prior audio + transcript — Behaviour.15).
  await db
    .update(speakingResponses)
    .set({ audioPath: key, transcript, durationMs, submittedAt: null })
    .where(eq(speakingResponses.id, row.id));

  return {
    transcript,
    audioUrl: audioUrlFor(sessionId, taskNumber),
    durationMs,
  };
}

// spec: docs/specs/speaking-session.md §Behaviour.10, 16; speaking-evaluation §Behaviour.6–8 — submit.
export async function submitResponse(
  db: DbClient,
  provider: LlmProvider,
  config: LlmConfig,
  sessionId: number,
  taskNumber: number,
): Promise<SubmitResult> {
  await loadSession(db, sessionId);
  const row = await loadResponse(db, sessionId, taskNumber);
  if (!row.transcript || row.transcript.trim().length === 0) {
    throw new ApiError(
      "NO_RECORDING",
      `No recording to submit for task ${taskNumber}.`,
    );
  }
  const task = await loadTaskForResponse(db, row);

  let score: number;
  let feedback: SpeakingFeedback;
  try {
    const result = await scoreWithClaude(
      {
        taskNumber: task.taskNumber,
        question: task.question,
        transcript: row.transcript,
      },
      provider,
    );
    score = result.score;
    feedback = result.feedback;
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError(
        "EVALUATION_FAILED",
        `Could not score the response: ${error.message}`,
        502,
      );
    }
    throw error;
  }

  await db
    .update(speakingResponses)
    .set({ submittedAt: new Date() })
    .where(eq(speakingResponses.id, row.id));
  await persistEvaluation(db, row.id, score, feedback, providerLabel(config));
  return { score, level: scoreToNclc(score), feedback };
}

// spec: docs/specs/speaking-session.md §Behaviour.10; speaking-evaluation §Behaviour.9 — correction
// (training only). The session's mode is checked here; the service itself is mode-agnostic.
export async function requestCorrection(
  db: DbClient,
  provider: LlmProvider,
  sessionId: number,
  taskNumber: number,
): Promise<SpeakingCorrection> {
  const session = await loadSession(db, sessionId);
  if (session.mode !== "learning") {
    throw new ApiError(
      "MODE_NOT_ALLOWED",
      "Corrections are only available in training mode.",
    );
  }

  const row = await loadResponse(db, sessionId, taskNumber);
  if (!row.transcript || row.transcript.trim().length === 0) {
    throw new ApiError(
      "NO_RECORDING",
      `No recording to correct for task ${taskNumber}.`,
    );
  }
  const task = await loadTaskForResponse(db, row);

  try {
    return await correctWithClaude(
      {
        question: task.question,
        transcript: row.transcript,
      },
      provider,
    );
  } catch (error) {
    if (error instanceof ClaudeError) {
      throw new ApiError(
        "CORRECTION_FAILED",
        `Could not produce a correction: ${error.message}`,
        502,
      );
    }
    throw error;
  }
}

// spec: docs/specs/speaking-session.md §Behaviour.14, 16, 17a; API contract — finalise + aggregate.
export async function completeSpeakingSession(
  db: DbClient,
  provider: LlmProvider,
  config: LlmConfig,
  sessionId: number,
  elapsedMs: number | null,
): Promise<CompleteResult> {
  const session = await loadSession(db, sessionId);

  const responses = await db
    .select()
    .from(speakingResponses)
    .where(eq(speakingResponses.sessionId, sessionId))
    .orderBy(asc(speakingResponses.taskNumber));

  let evals = await loadEvaluations(
    db,
    responses.map((r) => r.id),
  );

  // Idempotent: a session already finalised is not re-scored and its completion timestamp/elapsed
  // time are left untouched — a repeated complete call just re-reports the persisted aggregate.
  if (!session.completedAt) {
    // spec: docs/specs/speaking-session.md §Behaviour.14 — real mode submits/evaluates any recorded
    // task still unscored (best-effort: a CLI failure leaves that task unscored rather than blocking).
    if (session.mode === "real") {
      for (const row of responses) {
        if (evals.has(row.id)) continue;
        if (!row.transcript || row.transcript.trim().length === 0) continue;
        const task = await loadTaskForResponse(db, row);
        try {
          const result = await scoreWithClaude(
            {
              taskNumber: task.taskNumber,
              question: task.question,
              transcript: row.transcript,
            },
            provider,
          );
          await db
            .update(speakingResponses)
            .set({ submittedAt: row.submittedAt ?? new Date() })
            .where(eq(speakingResponses.id, row.id));
          await persistEvaluation(
            db,
            row.id,
            result.score,
            result.feedback,
            providerLabel(config),
          );
        } catch (error) {
          if (!(error instanceof ClaudeError)) throw error;
          // leave unscored
        }
      }
      evals = await loadEvaluations(
        db,
        responses.map((r) => r.id),
      );
    }

    await db
      .update(sessions)
      .set({
        completedAt: new Date(),
        elapsedMs: session.mode === "real" ? elapsedMs : null,
      })
      .where(eq(sessions.id, sessionId));
  }

  const tasks = responses.map((r) => {
    const score = evals.get(r.id)?.score ?? null;
    return {
      taskNumber: r.taskNumber,
      score,
      level: score == null ? null : scoreToNclc(score),
    };
  });
  const submitted = tasks.filter((t) => t.score != null).length;
  // spec: docs/specs/speaking-session.md §Behaviour.17a — un-recorded/unscored tasks count as 0.
  const overallScore = responses.length
    ? Math.round(
        tasks.reduce((sum, t) => sum + (t.score ?? 0), 0) / responses.length,
      )
    : 0;

  return { tasks, overallScore, submitted };
}
