// spec: docs/specs/quiz-session.md §Mode selection.3 + §Scoring
// Single source of truth for the six exam bands. The learning-mode difficulty levels map
// directly onto the scoring tiers, so one table drives both difficulty selection and scoring.

export type DifficultySlug =
  | 'beginner'
  | 'elementary'
  | 'intermediate'
  | 'upper-intermediate'
  | 'advanced'
  | 'expert';

export type Band = {
  slug: DifficultySlug;
  label: string;
  /** inclusive lower bound of the 1-based question sequence */
  min: number;
  /** inclusive upper bound of the 1-based question sequence */
  max: number;
  /** points awarded per correct answer within this band */
  points: number;
};

export const BANDS: readonly Band[] = [
  { slug: 'beginner', label: 'Beginner (Q1–4, 3 pts)', min: 1, max: 4, points: 3 },
  { slug: 'elementary', label: 'Elementary (Q5–10, 9 pts)', min: 5, max: 10, points: 9 },
  { slug: 'intermediate', label: 'Intermediate (Q11–19, 15 pts)', min: 11, max: 19, points: 15 },
  {
    slug: 'upper-intermediate',
    label: 'Upper-Intermediate (Q20–29, 21 pts)',
    min: 20,
    max: 29,
    points: 21,
  },
  { slug: 'advanced', label: 'Advanced (Q30–35, 26 pts)', min: 30, max: 35, points: 26 },
  { slug: 'expert', label: 'Expert (Q36–39, 33 pts)', min: 36, max: 39, points: 33 },
];

// Sum of every question at full value: 4·3 + 6·9 + 9·15 + 10·21 + 6·26 + 4·33 = 699.
export const MAX_SECTION_POINTS = 699;

// spec: docs/specs/quiz-session.md §Mode selection.3
export function isDifficultySlug(value: unknown): value is DifficultySlug {
  return typeof value === 'string' && BANDS.some((b) => b.slug === value);
}

// spec: docs/specs/quiz-session.md §Mode selection.3
export function bandForSlug(slug: string): Band | undefined {
  return BANDS.find((b) => b.slug === slug);
}

// spec: docs/specs/quiz-session.md §Scoring.15
export function pointsForSequence(sequence: number): number {
  const band = BANDS.find((b) => sequence >= b.min && sequence <= b.max);
  return band ? band.points : 0;
}

// spec: docs/specs/quiz-session.md §Mode selection.3 — band membership by sequence
export function sequenceInBand(sequence: number, band: Band): boolean {
  return sequence >= band.min && sequence <= band.max;
}
