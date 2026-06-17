// spec: docs/specs/writing-evaluation.md §Score → NCLC (Behaviour.6a–6b)
// The NCLC level is a pure, deterministic function of a per-task score (0–20) — never produced by
// the model and never persisted. The same helper derives the per-task levels and the overall level
// (from the rounded mean of the per-task scores). Shared by writing (and, later, speaking).
//
// The band boundaries are provisional defaults (see writing-evaluation §Open questions) — confirm
// against the official TCF/NCLC correspondence.

type NclcBand = { min: number; max: number; level: string };

const NCLC_BANDS: readonly NclcBand[] = [
  { min: 18, max: 20, level: 'NCLC 10+' },
  { min: 16, max: 17, level: 'NCLC 9' },
  { min: 14, max: 15, level: 'NCLC 8' },
  { min: 12, max: 13, level: 'NCLC 7' },
  { min: 10, max: 11, level: 'NCLC 6' },
  { min: 8, max: 9, level: 'NCLC 5' },
  { min: 6, max: 7, level: 'NCLC 4' },
  { min: 4, max: 5, level: 'NCLC 3' },
  { min: 0, max: 3, level: 'NCLC 1–2' },
];

// Derive the NCLC level for a per-task or overall score. The score is clamped into 0–20.
export function scoreToNclc(score: number): string {
  const clamped = Math.max(0, Math.min(20, Math.round(score)));
  const band = NCLC_BANDS.find((b) => clamped >= b.min && clamped <= b.max);
  // The bands cover the whole 0–20 range, so this fallback is defensive only.
  return band ? band.level : 'NCLC 1–2';
}
