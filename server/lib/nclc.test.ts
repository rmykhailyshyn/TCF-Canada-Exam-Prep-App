import { describe, expect, it } from 'vitest';
import { scoreToNclc } from './nclc';

describe('scoreToNclc', () => {
  it('maps each band boundary deterministically', () => {
    expect(scoreToNclc(20)).toBe('NCLC 10+');
    expect(scoreToNclc(18)).toBe('NCLC 10+');
    expect(scoreToNclc(17)).toBe('NCLC 9');
    expect(scoreToNclc(14)).toBe('NCLC 8');
    expect(scoreToNclc(12)).toBe('NCLC 7');
    expect(scoreToNclc(10)).toBe('NCLC 6');
    expect(scoreToNclc(8)).toBe('NCLC 5');
    expect(scoreToNclc(6)).toBe('NCLC 4');
    expect(scoreToNclc(4)).toBe('NCLC 3');
    expect(scoreToNclc(0)).toBe('NCLC 1–2');
  });

  it('is a pure function of the score (same input → same level)', () => {
    expect(scoreToNclc(13)).toBe(scoreToNclc(13));
  });

  it('rounds and clamps out-of-range / fractional scores', () => {
    expect(scoreToNclc(13.4)).toBe('NCLC 7');
    expect(scoreToNclc(25)).toBe('NCLC 10+');
    expect(scoreToNclc(-5)).toBe('NCLC 1–2');
  });
});
