import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  sessions,
  speakingEvaluations,
  speakingResponses,
  speakingTasks,
} from "../db/schema";
import { type TestDb, cleanupDbs, freshDb } from "../test-support/db";
import { type FakeMediaStore, fakeMediaStore } from "../test-support/fakes";
import {
  audioKeyFor,
  audioUrlFor,
  completeSpeakingSessionUnscored,
  contentTypeForKey,
  createSpeakingSession,
  extensionForMime,
  getResponseAudioKey,
  getSpeakingSession,
  storeRecording,
} from "./speaking";

// spec: docs/specs/speaking-session.md §Behaviour.3–6, 12, 15, 17a; §API contract
// spec: docs/specs/content-deploy.md §Behaviour.5, 7 (portable practice-only path)
//
// The PORTABLE half of the speaking service — the code the Worker runs. The Node-only transcribing
// upload and Claude scoring live in speaking-node.ts and are covered by routes/node-routes.test.ts.

let db: TestDb;
let media: FakeMediaStore;

beforeEach(async () => {
  db = await freshDb();
  media = fakeMediaStore();
});

afterEach(() => {
  cleanupDbs();
});

async function seedTasks(): Promise<void> {
  await db.insert(speakingTasks).values([
    {
      sourceFile: "s.json",
      sequence: 0,
      taskNumber: 1,
      question: "Parlez de vous.",
      sampleAnswer: "Je m'appelle…",
    },
    {
      sourceFile: "s.json",
      sequence: 1,
      taskNumber: 2,
      question: "Posez des questions.",
      sampleAnswer: "Pourriez-vous…",
    },
    {
      sourceFile: "s.json",
      sequence: 2,
      taskNumber: 3,
      question: "Argumentez.",
      sampleAnswer: "À mon avis…",
    },
  ]);
}

describe("pure helpers", () => {
  // spec: §Behaviour.3 — the per-task audio URL the UI streams from.
  it("builds the per-task audio URL", () => {
    expect(audioUrlFor(4, 2)).toBe(
      "/api/speaking/sessions/4/responses/2/audio",
    );
  });

  // spec: §Behaviour.15 — a portable RELATIVE key under speaking/, not an absolute path.
  it("builds a relative media key under the speaking subfolder", () => {
    expect(audioKeyFor(4, 2, "webm")).toBe("speaking/session-4-task-2.webm");
  });

  it.each([
    ["audio/webm;codecs=opus", "webm"],
    ["audio/ogg", "ogg"],
    ["audio/mp4", "m4a"],
    ["audio/x-m4a", "m4a"],
    ["audio/aac", "m4a"],
    ["audio/wav", "wav"],
    ["audio/mpeg", "mp3"],
    ["audio/mp3", "mp3"],
  ])("maps the %s upload to a .%s file", (mime, ext) => {
    expect(extensionForMime(mime)).toBe(ext);
  });

  // Browsers record WebM/Opus by default, so that is the safe fallback.
  it("falls back to webm for an unknown or absent MIME type", () => {
    expect(extensionForMime(undefined)).toBe("webm");
    expect(extensionForMime("")).toBe("webm");
    expect(extensionForMime("application/octet-stream")).toBe("webm");
  });

  it.each([
    ["speaking/a.webm", "audio/webm"],
    ["speaking/a.ogg", "audio/ogg"],
    ["speaking/a.m4a", "audio/mp4"],
    ["speaking/a.wav", "audio/wav"],
    ["speaking/a.mp3", "audio/mpeg"],
  ])("derives the content type of %s", (key, expected) => {
    expect(contentTypeForKey(key)).toBe(expected);
  });

  it("falls back to octet-stream for an unknown key extension", () => {
    expect(contentTypeForKey("speaking/a.bin")).toBe("application/octet-stream");
    expect(contentTypeForKey("speaking/a")).toBe("application/octet-stream");
  });
});

describe("createSpeakingSession", () => {
  // spec: §Behaviour.4 — real mode always runs all three tasks.
  it("always uses all three tasks in real mode, ignoring taskNumbers", async () => {
    await seedTasks();
    const res = await createSpeakingSession(db, {
      mode: "real",
      taskNumbers: [2],
    });
    expect(res.tasks.map((t) => t.taskNumber)).toEqual([1, 2, 3]);
    expect(res.timing).not.toBeNull();
  });

  // spec: §Behaviour.5 — training may run a single task.
  it("narrows to the requested tasks in training mode", async () => {
    await seedTasks();
    const res = await createSpeakingSession(db, {
      mode: "learning",
      taskNumbers: [3, 1, 1],
    });
    expect(res.tasks.map((t) => t.taskNumber)).toEqual([1, 3]);
  });

  it("uses all three tasks when training passes no selection", async () => {
    await seedTasks();
    for (const input of [
      { mode: "learning" as const },
      { mode: "learning" as const, taskNumbers: [] },
    ]) {
      const res = await createSpeakingSession(db, input);
      expect(res.tasks).toHaveLength(3);
    }
  });

  it("rejects a task number outside 1–3", async () => {
    await seedTasks();
    await expect(
      createSpeakingSession(db, { mode: "learning", taskNumbers: [4] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // spec: §Behaviour.12 — training reveals the sample answer, real mode does not.
  it("returns no timing in training mode", async () => {
    await seedTasks();
    const res = await createSpeakingSession(db, { mode: "learning" });
    expect(res.timing).toBeNull();
  });

  it("creates one response row per selected task", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, {
      mode: "learning",
      taskNumbers: [1, 2],
    });
    const rows = await db
      .select()
      .from(speakingResponses)
      .where(eq(speakingResponses.sessionId, sessionId));
    expect(rows).toHaveLength(2);
  });

  it("fails when no tasks have been imported", async () => {
    await expect(
      createSpeakingSession(db, { mode: "real" }),
    ).rejects.toBeDefined();
  });
});

describe("getSpeakingSession", () => {
  it("404s an unknown session", async () => {
    await expect(getSpeakingSession(db, 999)).rejects.toMatchObject({
      status: 404,
    });
  });

  // spec: §Behaviour.12 — the sample answer is training-only.
  it("exposes the sample answer in training mode", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.tasks[0].sampleAnswer).toBe("Je m'appelle…");
  });

  it("hides the sample answer in real mode", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "real" });
    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.tasks[0].sampleAnswer).toBeNull();
  });

  it("reports no audio for a task that has not been recorded", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.tasks[0]).toMatchObject({
      hasAudio: false,
      audioUrl: null,
      submitted: false,
      score: null,
      level: null,
      feedback: null,
    });
  });

  it("exposes the audio URL once a take is stored", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await storeRecording(db, media, sessionId, 1, Buffer.from([1, 2]), "audio/webm");
    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.tasks[0]).toMatchObject({
      hasAudio: true,
      audioUrl: audioUrlFor(sessionId, 1),
    });
  });

  it("carries the score, derived level and feedback of an evaluated task", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    const [row] = await db
      .select()
      .from(speakingResponses)
      .where(eq(speakingResponses.sessionId, sessionId));
    await db.insert(speakingEvaluations).values({
      responseId: row.id,
      score: 16,
      strengths: "s",
      errors: "e",
      improvements: "i",
      generatedBy: "test",
    });

    const detail = await getSpeakingSession(db, sessionId);
    const task = detail.tasks.find((t) => t.taskNumber === row.taskNumber)!;
    expect(task.score).toBe(16);
    expect(task.level).toMatch(/^NCLC /);
    expect(task.feedback).toEqual({
      strengths: "s",
      errors: "e",
      improvements: "i",
    });
  });

  // spec: docs/specs/content-deploy.md §Behaviour.7 — an in-progress session reports no overall score.
  it("reports a null overall score while the session is unfinished", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.session.completedAt).toBeNull();
    expect(detail.session.overallScore).toBeNull();
  });

  // spec: §Behaviour.17a — unscored tasks count as 0 in the mean: round(15/3) = 5.
  it("averages over all tasks once completed, counting unscored tasks as zero", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    const [row] = await db
      .select()
      .from(speakingResponses)
      .where(eq(speakingResponses.sessionId, sessionId));
    await db.insert(speakingEvaluations).values({
      responseId: row.id,
      score: 15,
      strengths: "s",
      errors: "e",
      improvements: "i",
      generatedBy: "test",
    });
    await db
      .update(sessions)
      .set({ completedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.session.overallScore).toBe(5);
    expect(detail.session.submitted).toBe(1);
  });

  // spec: docs/specs/content-deploy.md §Behaviour.7 — never fabricate 0/20 for an unscored session.
  it("reports null (not zero) for a completed session with no scores at all", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await db
      .update(sessions)
      .set({ completedAt: new Date() })
      .where(eq(sessions.id, sessionId));
    const detail = await getSpeakingSession(db, sessionId);
    expect(detail.session.overallScore).toBeNull();
    expect(detail.session.submitted).toBe(0);
  });
});

describe("storeRecording (portable, practice-only)", () => {
  // spec: docs/specs/content-deploy.md §Behaviour.5 — store the bytes, produce NO transcript.
  it("stores the bytes and returns an empty transcript", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    const res = await storeRecording(
      db,
      media,
      sessionId,
      1,
      Buffer.from([1, 2, 3]),
      "audio/webm",
    );
    expect(res.transcript).toBe("");
    expect(res.audioUrl).toBe(audioUrlFor(sessionId, 1));
    expect(media.keys()).toEqual([audioKeyFor(sessionId, 1, "webm")]);
  });

  // spec: §Behaviour.15 — re-recording replaces the take; a stale object under a DIFFERENT key goes.
  it("removes the previous take when the extension changes", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await storeRecording(db, media, sessionId, 1, Buffer.from([1]), "audio/webm");
    await storeRecording(db, media, sessionId, 1, Buffer.from([2]), "audio/ogg");
    expect(media.keys()).toEqual([audioKeyFor(sessionId, 1, "ogg")]);
  });

  it("overwrites in place when the extension is unchanged", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await storeRecording(db, media, sessionId, 1, Buffer.from([1]), "audio/webm");
    await storeRecording(
      db,
      media,
      sessionId,
      1,
      Buffer.from([2, 2]),
      "audio/webm",
    );
    expect(media.keys()).toHaveLength(1);
    expect(media.bytes(audioKeyFor(sessionId, 1, "webm"))?.byteLength).toBe(2);
  });

  it("404s an unknown session", async () => {
    await expect(
      storeRecording(db, media, 999, 1, Buffer.from([1]), "audio/webm"),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("getResponseAudioKey", () => {
  it("404s a task with no stored recording", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await expect(getResponseAudioKey(db, sessionId, 1)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("returns the stored key with its derived content type", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await storeRecording(db, media, sessionId, 1, Buffer.from([1]), "audio/ogg");
    await expect(getResponseAudioKey(db, sessionId, 1)).resolves.toEqual({
      key: audioKeyFor(sessionId, 1, "ogg"),
      contentType: "audio/ogg",
    });
  });
});

describe("completeSpeakingSessionUnscored", () => {
  // spec: docs/specs/content-deploy.md §Behaviour.7 — online completion never invents a score.
  it("finalises the session with a null overall score", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "real" });
    const res = await completeSpeakingSessionUnscored(db, sessionId, 300_000);
    expect(res.overallScore).toBeNull();
    expect(res.submitted).toBe(0);
    expect(res.tasks).toHaveLength(3);
    expect(res.tasks.every((t) => t.score === null && t.level === null)).toBe(
      true,
    );

    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(row.completedAt).toBeInstanceOf(Date);
    expect(row.elapsedMs).toBe(300_000);
  });

  it("stores no elapsed time for a training session", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "learning" });
    await completeSpeakingSessionUnscored(db, sessionId, 300_000);
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(row.elapsedMs).toBeNull();
  });

  // Repeating the call must not move the completion timestamp.
  it("is idempotent on a second call", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "real" });
    await completeSpeakingSessionUnscored(db, sessionId, 1000);
    const [first] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    await completeSpeakingSessionUnscored(db, sessionId, 9999);
    const [second] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    expect(second.completedAt?.getTime()).toBe(first.completedAt?.getTime());
    expect(second.elapsedMs).toBe(1000);
  });

  it("still reports a score that was persisted before completion", async () => {
    await seedTasks();
    const { sessionId } = await createSpeakingSession(db, { mode: "real" });
    const [row] = await db
      .select()
      .from(speakingResponses)
      .where(eq(speakingResponses.sessionId, sessionId));
    await db.insert(speakingEvaluations).values({
      responseId: row.id,
      score: 12,
      strengths: "s",
      errors: "e",
      improvements: "i",
      generatedBy: "test",
    });
    const res = await completeSpeakingSessionUnscored(db, sessionId, null);
    expect(res.submitted).toBe(1);
    expect(res.overallScore).toBe(4); // round(12 / 3)
  });

  it("404s an unknown session", async () => {
    await expect(
      completeSpeakingSessionUnscored(db, 999, null),
    ).rejects.toMatchObject({ status: 404 });
  });
});
