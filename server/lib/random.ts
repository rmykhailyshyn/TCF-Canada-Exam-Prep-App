// spec: docs/specs/quiz-session.md §Question selection and ordering (Behaviour.19–22)
// Small randomization helpers for session question selection/ordering. The RNG is injectable
// (defaults to Math.random) so the selection logic is deterministically unit-testable.

export type Rng = () => number;

// Fisher–Yates shuffle. Returns a NEW array (does not mutate the input) so callers can keep the
// original import order around.
export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Picks one element at random. Throws on an empty array — callers must guarantee a non-empty pool
// (real-mode selection only draws from positions known to have at least one keyed candidate).
export function pickOne<T>(items: readonly T[], rng: Rng = Math.random): T {
  if (items.length === 0) {
    throw new Error('pickOne called with an empty array');
  }
  return items[Math.floor(rng() * items.length)];
}
