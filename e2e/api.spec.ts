import { expect, test } from '@playwright/test';

// spec: docs/specs/listening-player.md §API contract
// Exercises the player's two read endpoints (audio stream with range support, transcript envelope)
// and their NOT_FOUND behaviour. Requests go through the Vite proxy to the Express server.

// Resolves a real seeded listening question id by creating a learning session.
async function firstListeningQuestionId(request: import('@playwright/test').APIRequestContext): Promise<number> {
  const res = await request.post('/api/sessions', {
    data: { section: 'listening', mode: 'learning', difficulty: 'beginner' },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.error).toBeNull();
  expect(body.data.questions.length).toBeGreaterThan(0);
  return body.data.questions[0].id as number;
}

test('GET /api/questions/:id/transcript returns ordered segments in the envelope', async ({
  request,
}) => {
  const id = await firstListeningQuestionId(request);
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
}) => {
  const id = await firstListeningQuestionId(request);

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
