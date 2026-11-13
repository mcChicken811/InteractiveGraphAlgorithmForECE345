import { describe, expect, it } from 'vitest';
import { fitFontSize } from '../src/label-fit.js';

describe('fitFontSize', () => {
  it('keeps the largest size when the text fits', () => {
    expect(fitFontSize('3', 32, 14)).toBe(14);
    expect(fitFontSize('1,6', 32, 14)).toBe(14);
    expect(fitFontSize('', 32, 14)).toBe(14);
  });

  it('shrinks longer text, in half-pixel steps, so it fits the width', () => {
    const size = fitFontSize('12,15', 32, 14);
    expect(size).toBeLessThan(14);
    expect(size * 2).toBe(Math.round(size * 2));
    // Estimated width at that size: 4 digits (~0.62em) + a comma (~0.3em).
    expect(size * (4 * 0.62 + 0.3)).toBeLessThanOrEqual(32);
    expect(fitFontSize('100,101', 32, 14)).toBeLessThan(size); // longer → smaller
  });
});
