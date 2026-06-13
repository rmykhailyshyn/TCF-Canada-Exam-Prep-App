import { describe, expect, it } from 'vitest';
import { pickOne, shuffle, type Rng } from './random';

// A deterministic RNG that replays a fixed sequence of [0,1) values, looping if exhausted.
function seededRng(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('shuffle', () => {
  it('does not mutate the input and preserves the multiset of elements', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffle(input, seededRng([0.9, 0.1, 0.7, 0.3, 0.5]));
    expect(input).toEqual([1, 2, 3, 4, 5]); // untouched
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]); // same elements
  });

  it('reorders elements for a non-identity RNG', () => {
    // rng() === 0 makes every Fisher–Yates step swap index i with index 0 → a guaranteed reorder.
    const out = shuffle([1, 2, 3, 4, 5], () => 0);
    expect(out).not.toEqual([1, 2, 3, 4, 5]);
    expect([...out].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('handles empty and single-element arrays', () => {
    expect(shuffle([])).toEqual([]);
    expect(shuffle([42])).toEqual([42]);
  });
});

describe('pickOne', () => {
  it('selects by index from the RNG value', () => {
    expect(pickOne(['a', 'b', 'c', 'd'], () => 0)).toBe('a');
    expect(pickOne(['a', 'b', 'c', 'd'], () => 0.5)).toBe('c');
    expect(pickOne(['a', 'b', 'c', 'd'], () => 0.999)).toBe('d');
  });

  it('throws on an empty array', () => {
    expect(() => pickOne([])).toThrow();
  });
});
