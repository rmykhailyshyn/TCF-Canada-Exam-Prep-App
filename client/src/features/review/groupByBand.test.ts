import { describe, expect, it } from 'vitest';
import type { QuestionResultRow } from '../../lib/api';
import { groupIncorrectByBand } from './groupByBand';

// spec: docs/specs/review-mode.md §Behaviour.8–9

function row(overrides: Partial<QuestionResultRow>): QuestionResultRow {
  return {
    id: 1,
    questionId: 1,
    sequence: 1,
    text: 'q',
    passage: null,
    options: [],
    chosenLabel: 'A',
    correctLabel: 'A',
    isCorrect: true,
    difficulty: 'beginner',
    explanation: null,
    answeredAt: '2026-06-10T00:00:00.000Z',
    ...overrides,
  };
}

describe('groupIncorrectByBand', () => {
  it('returns no bands when every answer is correct', () => {
    expect(groupIncorrectByBand([row({ isCorrect: true }), row({ isCorrect: true })])).toEqual([]);
  });

  it('groups only incorrect answers by their band, with ids and counts', () => {
    const results = [
      row({ questionId: 11, difficulty: 'intermediate', isCorrect: false }),
      row({ questionId: 12, difficulty: 'intermediate', isCorrect: true }),
      row({ questionId: 13, difficulty: 'intermediate', isCorrect: false }),
      row({ questionId: 31, difficulty: 'advanced', isCorrect: false }),
    ];
    expect(groupIncorrectByBand(results)).toEqual([
      { difficulty: 'intermediate', questionIds: [11, 13], count: 2 },
      { difficulty: 'advanced', questionIds: [31], count: 1 },
    ]);
  });

  it('orders affected bands canonically (Beginner → Expert) regardless of input order', () => {
    const results = [
      row({ questionId: 36, difficulty: 'expert', isCorrect: false }),
      row({ questionId: 1, difficulty: 'beginner', isCorrect: false }),
      row({ questionId: 20, difficulty: 'upper-intermediate', isCorrect: false }),
    ];
    expect(groupIncorrectByBand(results).map((b) => b.difficulty)).toEqual([
      'beginner',
      'upper-intermediate',
      'expert',
    ]);
  });

  it('ignores rows with a null difficulty', () => {
    expect(groupIncorrectByBand([row({ difficulty: null, isCorrect: false })])).toEqual([]);
  });
});
