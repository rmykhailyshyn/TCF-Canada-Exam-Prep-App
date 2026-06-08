import type { DifficultySlug } from './api';

// spec: docs/specs/reading-quiz-ui.md §Session setup.1 — the six labelled difficulty bands.
// Display metadata for the difficulty picker; the authoritative ranges/points live server-side.

export type BandDisplay = {
  slug: DifficultySlug;
  name: string;
  range: string;
  points: number;
};

export const DIFFICULTY_BANDS: readonly BandDisplay[] = [
  { slug: 'beginner', name: 'Beginner', range: 'Q1–4', points: 3 },
  { slug: 'elementary', name: 'Elementary', range: 'Q5–10', points: 9 },
  { slug: 'intermediate', name: 'Intermediate', range: 'Q11–19', points: 15 },
  { slug: 'upper-intermediate', name: 'Upper-Intermediate', range: 'Q20–29', points: 21 },
  { slug: 'advanced', name: 'Advanced', range: 'Q30–35', points: 26 },
  { slug: 'expert', name: 'Expert', range: 'Q36–39', points: 33 },
];

export function bandName(slug: DifficultySlug): string {
  const band = DIFFICULTY_BANDS.find((b) => b.slug === slug);
  return band ? `${band.name} (${band.range}, ${band.points} pts)` : slug;
}
