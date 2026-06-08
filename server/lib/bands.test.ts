import { describe, expect, it } from 'vitest';
import {
  BANDS,
  MAX_SECTION_POINTS,
  bandForSlug,
  isDifficultySlug,
  pointsForSequence,
  sequenceInBand,
} from './bands';

describe('bands', () => {
  // spec: docs/specs/quiz-session.md §Scoring.15 — sequence→points map
  it('maps each sequence to the documented point value', () => {
    expect(pointsForSequence(1)).toBe(3);
    expect(pointsForSequence(4)).toBe(3);
    expect(pointsForSequence(5)).toBe(9);
    expect(pointsForSequence(10)).toBe(9);
    expect(pointsForSequence(11)).toBe(15);
    expect(pointsForSequence(19)).toBe(15);
    expect(pointsForSequence(20)).toBe(21);
    expect(pointsForSequence(29)).toBe(21);
    expect(pointsForSequence(30)).toBe(26);
    expect(pointsForSequence(35)).toBe(26);
    expect(pointsForSequence(36)).toBe(33);
    expect(pointsForSequence(39)).toBe(33);
  });

  it('scores 0 for sequences outside the 1–39 range', () => {
    expect(pointsForSequence(0)).toBe(0);
    expect(pointsForSequence(40)).toBe(0);
  });

  // spec: docs/specs/quiz-session.md §Scoring.15 — max 699 per section
  it('sums to exactly 699 across all 39 questions', () => {
    let total = 0;
    for (let seq = 1; seq <= 39; seq += 1) total += pointsForSequence(seq);
    expect(total).toBe(MAX_SECTION_POINTS);
    expect(total).toBe(699);
  });

  // spec: docs/specs/quiz-session.md §Mode selection.3 — six bands
  it('exposes the six difficulty slugs', () => {
    expect(BANDS.map((b) => b.slug)).toEqual([
      'beginner',
      'elementary',
      'intermediate',
      'upper-intermediate',
      'advanced',
      'expert',
    ]);
  });

  it('validates difficulty slugs', () => {
    expect(isDifficultySlug('intermediate')).toBe(true);
    expect(isDifficultySlug('nonsense')).toBe(false);
    expect(isDifficultySlug(undefined)).toBe(false);
  });

  it('resolves a band by slug and tests sequence membership', () => {
    const band = bandForSlug('intermediate')!;
    expect(band.min).toBe(11);
    expect(band.max).toBe(19);
    expect(sequenceInBand(15, band)).toBe(true);
    expect(sequenceInBand(10, band)).toBe(false);
    expect(sequenceInBand(20, band)).toBe(false);
  });
});
