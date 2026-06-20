import { type APIRequestContext, expect } from '@playwright/test';

// Thin wrapper over the JSON API used by the e2e suite. It centralises the {data,error} envelope
// unwrapping and the common session lifecycle so specs read at the level of intent. Raw endpoint
// assertions (headers, status codes, byte payloads) stay in the specs that target those endpoints.
// spec: docs/specs/quiz-session.md §API contract

export type Section = 'reading' | 'listening';
export type Mode = 'learning' | 'real';
export type Difficulty = 'beginner' | 'intermediate' | 'upper-intermediate' | 'advanced';

export type SessionQuestion = { id: number; sequence: number };
export type CreatedSession = { sessionId: number; questions: SessionQuestion[] };

export class ApiClient {
  constructor(private readonly request: APIRequestContext) {}

  // Creates a session and returns its unwrapped payload, asserting a 2xx + null error envelope.
  async createSession(opts: { section: Section; mode: Mode; difficulty?: Difficulty }): Promise<CreatedSession> {
    const res = await this.request.post('/api/sessions', { data: opts });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.error).toBeNull();
    return body.data as CreatedSession;
  }

  // Resolves a real seeded question id for a section (via a beginner learning session).
  async firstQuestionId(section: Section): Promise<number> {
    const { questions } = await this.createSession({ section, mode: 'learning', difficulty: 'beginner' });
    expect(questions.length).toBeGreaterThan(0);
    return questions[0].id;
  }

  async answer(sessionId: number, questionId: number, chosenLabel: string): Promise<void> {
    await this.request.post(`/api/sessions/${sessionId}/answers`, { data: { questionId, chosenLabel } });
  }

  async complete(sessionId: number, elapsedMs: number): Promise<void> {
    await this.request.post(`/api/sessions/${sessionId}/complete`, { data: { elapsedMs } });
  }

  async listSessions(): Promise<{ id: number; correct: number; total: number }[]> {
    const res = await this.request.get('/api/sessions');
    const body = await res.json();
    return body.data.sessions as { id: number; correct: number; total: number }[];
  }
}
