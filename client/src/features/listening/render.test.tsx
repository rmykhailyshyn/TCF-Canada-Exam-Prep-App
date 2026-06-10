import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { SessionQuestion, TranscriptSegment } from '../../lib/api';
import type { SessionConfig } from '../quiz/types';
import type { QuizSession } from '../quiz/useQuizSession';
import { ListeningQuizScreen } from './ListeningQuizScreen';
import { SubtitleList } from './SubtitleList';
import { activeSegmentIndex } from './useListeningPlayer';

// Render smoke tests + pure-logic tests for the listening feature. Components are executed under
// renderToStaticMarkup (node env, no DOM), so effects/audio APIs don't run — these guard against
// render-time throws and assert spec behaviours that don't need a live browser.

const segments: TranscriptSegment[] = [
  { sequence: 1, text: 'Bonjour à tous.', startMs: 0, endMs: 1500 },
  { sequence: 2, text: 'Voici les informations.', startMs: 1500, endMs: 3200 },
  { sequence: 3, text: 'Merci de votre attention.', startMs: 3200, endMs: 5000 },
];

const question: SessionQuestion = {
  id: 7,
  sequence: 12,
  text: 'Écoutez le document puis répondez.',
  passage: null,
  options: [
    { label: 'A', text: 'Option A' },
    { label: 'B', text: 'Option B' },
    { label: 'C', text: 'Option C' },
    { label: 'D', text: 'Option D' },
  ],
};

function fakeSession(overrides: Partial<QuizSession> = {}): QuizSession {
  return {
    status: 'active',
    error: null,
    sessionId: 1,
    mode: 'real',
    question,
    index: 4,
    total: 39,
    selectedLabel: null,
    feedback: null,
    remainingMs: 2_100_000,
    results: null,
    elapsedMs: null,
    submitting: false,
    select: vi.fn(),
    confirm: vi.fn(),
    goNext: vi.fn(),
    submitExam: vi.fn(),
    ...overrides,
  };
}

describe('activeSegmentIndex', () => {
  // spec: docs/specs/listening-player.md §Behaviour.7 — start_ms <= currentMs < next start_ms.
  it('returns -1 only while the current time precedes the first segment', () => {
    expect(activeSegmentIndex(segments, 0)).toBe(0); // first segment starts at 0
    expect(activeSegmentIndex([{ sequence: 1, text: 'x', startMs: 500, endMs: 900 }], 0)).toBe(-1);
  });

  it('selects the last segment whose start is at or before the current time', () => {
    expect(activeSegmentIndex(segments, 800)).toBe(0);
    expect(activeSegmentIndex(segments, 1500)).toBe(1);
    expect(activeSegmentIndex(segments, 3199)).toBe(1);
    expect(activeSegmentIndex(segments, 4000)).toBe(2);
  });
});

describe('SubtitleList', () => {
  // spec: docs/specs/listening-player.md §Behaviour.5–6 — list all phrases, highlight the active.
  it('renders every phrase and marks the active one', () => {
    const html = renderToStaticMarkup(
      <SubtitleList segments={segments} activeIndex={1} onSeek={vi.fn()} />,
    );
    expect(html).toContain('Bonjour à tous.');
    expect(html).toContain('Voici les informations.');
    expect(html).toContain('Merci de votre attention.');
    expect(html).toContain('aria-current="true"');
  });

  it('shows a placeholder when there are no subtitles', () => {
    const html = renderToStaticMarkup(
      <SubtitleList segments={[]} activeIndex={-1} onSeek={vi.fn()} />,
    );
    expect(html).toContain('No subtitles');
  });
});

describe('ListeningQuizScreen', () => {
  // spec: docs/specs/listening-quiz-ui.md §Layout.5–6 — counter + real-mode timer, options + player
  it('renders the header counter, timer, and question options (real mode)', () => {
    const config: SessionConfig = { section: 'listening', mode: 'real' };
    const html = renderToStaticMarkup(<ListeningQuizScreen session={fakeSession()} config={config} />);
    expect(html).toContain('Listening · Real');
    expect(html).toContain('Question 5 of 39');
    expect(html).toContain('⏱');
    expect(html).toContain('Submit exam');
    expect(html).toContain('Écoutez le document puis répondez.');
    // The audio element is rendered with the streaming endpoint as its source.
    expect(html).toContain('/api/questions/7/audio');
  });
});
