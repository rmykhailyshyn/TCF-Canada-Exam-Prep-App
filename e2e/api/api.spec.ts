import { expect, test } from '../fixtures/test';

// spec: docs/specs/listening-player.md §API contract
// Exercises the player's two read endpoints (audio stream with range support, transcript envelope)
// and their NOT_FOUND behaviour, plus the reading passage-image endpoint and session-selection
// contracts. Requests go through the Vite proxy to the Express server. Session creation and envelope
// unwrapping go through the ApiClient fixture; raw status/header/byte assertions stay inline here.

test.describe('Listening player endpoints', () => {
  test('GET /api/questions/:id/transcript returns ordered segments in the envelope', async ({
    request,
    api,
  }) => {
    const id = await api.firstQuestionId('listening');
    const res = await request.get(`/api/questions/${id}/transcript`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    const segments = body.data.segments as { sequence: number; text: string; startMs: number; endMs: number }[];
    expect(segments.length).toBeGreaterThan(0);
    // Ordered by sequence; every row satisfies startMs <= endMs.
    for (let i = 0; i < segments.length; i += 1) {
      expect(segments[i].sequence).toBe(i + 1);
      expect(segments[i].startMs).toBeLessThanOrEqual(segments[i].endMs);
      expect(typeof segments[i].text).toBe('string');
    }
  });

  test('GET /api/questions/:id/audio streams audio/mpeg and supports range requests', async ({
    request,
    api,
  }) => {
    const id = await api.firstQuestionId('listening');

    // Full request → 200 with audio/mpeg and Accept-Ranges.
    const full = await request.get(`/api/questions/${id}/audio`);
    expect(full.status()).toBe(200);
    expect(full.headers()['content-type']).toBe('audio/mpeg');
    expect(full.headers()['accept-ranges']).toBe('bytes');

    // Ranged request → 206 Partial Content with a Content-Range.
    const ranged = await request.get(`/api/questions/${id}/audio`, {
      headers: { Range: 'bytes=0-99' },
    });
    expect(ranged.status()).toBe(206);
    expect(ranged.headers()['content-range']).toMatch(/^bytes 0-99\/\d+$/);
    expect((await ranged.body()).length).toBe(100);
  });

  test('unknown question ids return a NOT_FOUND envelope / 404', async ({ request }) => {
    const transcript = await request.get('/api/questions/999999999/transcript');
    expect(transcript.status()).toBe(404);
    expect((await transcript.json()).error.code).toBe('NOT_FOUND');

    const audio = await request.get('/api/questions/999999999/audio');
    expect(audio.status()).toBe(404);
    expect((await audio.json()).error.code).toBe('NOT_FOUND');
  });
});

test.describe('Reading passage-image endpoint', () => {
  // spec: docs/specs/reading-quiz-ui.md §API contract GET /api/questions/:id/passage-image
  test('serves the reading passage image', async ({ request, api }) => {
    const id = await api.firstQuestionId('reading');
    const res = await request.get(`/api/questions/${id}/passage-image`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    // A real PNG: the 8-byte signature starts with 0x89 'PNG'.
    const bytes = await res.body();
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('\x89PNG');
  });

  test('returns PASSAGE_IMAGE_NOT_FOUND for a listening question and unknown ids', async ({
    request,
    api,
  }) => {
    // A listening question has no passage → 404 PASSAGE_IMAGE_NOT_FOUND.
    const listeningId = await api.firstQuestionId('listening');
    const listening = await request.get(`/api/questions/${listeningId}/passage-image`);
    expect(listening.status()).toBe(404);
    expect((await listening.json()).error.code).toBe('PASSAGE_IMAGE_NOT_FOUND');

    const unknown = await request.get('/api/questions/999999999/passage-image');
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error.code).toBe('PASSAGE_IMAGE_NOT_FOUND');
  });
});

test.describe('Question selection and session history', () => {
  // spec: docs/specs/quiz-session.md §Question selection and ordering (Behaviour.19–22)
  test('real-mode reading session has one question per sequence position (39, distinct)', async ({ api }) => {
    const { questions } = await api.createSession({ section: 'reading', mode: 'real' });
    const sequences = questions.map((q) => q.sequence);
    // The dev seed fills positions 1..39 → exactly 39 questions, one per position, ascending.
    expect(sequences.length).toBe(39);
    expect(new Set(sequences).size).toBe(39);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
  });

  // spec: docs/specs/quiz-session.md §Question selection.21 — learning order is randomized.
  test('learning-mode question order is randomized across sessions', async ({ api }) => {
    // Intermediate band has 9 questions; collect the order of several sessions. A fixed order would
    // make every ordering identical — 9! possible orders make all-identical astronomically unlikely.
    const orders = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const { questions } = await api.createSession({
        section: 'reading',
        mode: 'learning',
        difficulty: 'intermediate',
      });
      orders.add(questions.map((q) => q.sequence).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  // spec: docs/specs/progress-tracking.md §Behaviour.6 — Milestone 9 regression: the history list's
  // `correct` count must reflect actual correctness, not equal `total`. (listSessions previously
  // counted all recorded answers for both, so every row read N/N.)
  test('history list reports correct < total for a partially-correct session', async ({ api }) => {
    // Start a real reading exam and answer every question with 'A'. The seed's correct answers are a
    // mix of labels, so a fixed 'A' yields some right and some wrong → 0 < correct < total.
    const { sessionId, questions } = await api.createSession({ section: 'reading', mode: 'real' });
    for (const q of questions) {
      await api.answer(sessionId, q.id, 'A');
    }
    await api.complete(sessionId, 1000);

    const row = (await api.listSessions()).find((s) => s.id === sessionId);
    expect(row).toBeTruthy();
    expect(row!.total).toBe(questions.length);
    expect(row!.correct).toBeGreaterThan(0);
    expect(row!.correct).toBeLessThan(row!.total);
  });
});
