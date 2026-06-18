import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SpeakingCompleteResult, SpeakingTask } from '../../lib/api';
import { SpeakingResults } from './SpeakingResults';
import { SpeakingSession } from './SpeakingSession';
import { SpeakingSetup } from './SpeakingSetup';
import type { SpeakingSession as SpeakingSessionState } from './useSpeakingSession';

const tasks: SpeakingTask[] = [
  { taskId: 1, taskNumber: 1, question: 'Présentez-vous.', sampleAnswer: 'Bonjour !' },
  { taskId: 2, taskNumber: 2, question: 'Renseignez-vous.', sampleAnswer: null },
];

function fakeSession(overrides: Partial<SpeakingSessionState> = {}): SpeakingSessionState {
  return {
    status: 'active',
    error: null,
    sessionId: 1,
    mode: 'learning',
    tasks,
    timing: null,
    recordings: {},
    transcripts: { 1: 'Bonjour, je m’appelle…' },
    evaluations: {},
    corrections: {},
    uploading: {},
    taskError: {},
    recordingTask: null,
    busyTask: null,
    micError: null,
    currentIndex: 0,
    realPhase: 'prep',
    phaseRemainingMs: null,
    results: null,
    elapsedMs: null,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    submit: vi.fn(),
    correct: vi.fn(),
    finish: vi.fn(),
    submitExam: vi.fn(),
    ...overrides,
  };
}

describe('SpeakingSetup', () => {
  it('offers Training and Real modes', () => {
    const html = renderToStaticMarkup(<SpeakingSetup onStart={vi.fn()} />);
    expect(html).toContain('Training');
    expect(html).toContain('Real');
    expect(html).toContain('Start speaking');
  });
});

describe('SpeakingSession', () => {
  it('renders the question, transcript, and training actions in training mode', () => {
    const html = renderToStaticMarkup(<SpeakingSession session={fakeSession()} />);
    expect(html).toContain('Présentez-vous.');
    expect(html).toContain('Submit for score');
    expect(html).toContain('Get correction');
    expect(html).toContain('lang="fr"');
  });

  it('shows the phase countdown and hides guidance in real mode', () => {
    const html = renderToStaticMarkup(
      <SpeakingSession
        session={fakeSession({ mode: 'real', timing: [{ taskNumber: 1, prepSeconds: 0, recordSeconds: 120 }], realPhase: 'recording', phaseRemainingMs: 120_000 })}
      />,
    );
    expect(html).toContain('Submit exam');
    expect(html).not.toContain('Get correction');
    expect(html).toContain('⏱');
  });
});

describe('SpeakingResults', () => {
  it('renders the overall average and per-task scores', () => {
    const results: SpeakingCompleteResult = {
      tasks: [
        { taskNumber: 1, score: 15, level: 'NCLC 8' },
        { taskNumber: 2, score: 11, level: 'NCLC 6' },
        { taskNumber: 3, score: null, level: null },
      ],
      overallScore: 9,
      submitted: 2,
    };
    const html = renderToStaticMarkup(
      <SpeakingResults results={results} elapsedMs={null} onHome={vi.fn()} />,
    );
    expect(html).toContain('9');
    expect(html).toContain('15 / 20');
    expect(html).toContain('NCLC 8');
    expect(html).toContain('2 / 3 tasks submitted');
  });
});
