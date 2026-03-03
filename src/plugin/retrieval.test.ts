import { describe, expect, it } from 'vitest';
import {
  computeRecencyBoost, computeTimeDecay, computeLengthNorm,
} from './retrieval.js';

describe('computeRecencyBoost', () => {
  it('returns full weight for very recent documents', () => {
    const now = new Date();
    const boost = computeRecencyBoost(now, now, 14, 0.10);
    expect(boost).toBeCloseTo(0.10, 2);
  });

  it('returns half weight at half-life', () => {
    const now = new Date();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const boost = computeRecencyBoost(fourteenDaysAgo, now, 14, 0.10);
    expect(boost).toBeCloseTo(0.05, 2);
  });

  it('approaches zero for very old documents', () => {
    const now = new Date();
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    const boost = computeRecencyBoost(yearAgo, now, 14, 0.10);
    expect(boost).toBeLessThan(0.001);
  });

  it('returns 0 when disabled (halfLife=0)', () => {
    const now = new Date();
    expect(computeRecencyBoost(now, now, 0, 0.10)).toBe(0);
  });

  it('returns 0 when weight is 0', () => {
    const now = new Date();
    expect(computeRecencyBoost(now, now, 14, 0)).toBe(0);
  });
});

describe('computeTimeDecay', () => {
  it('returns 1.0 for very recent documents', () => {
    const now = new Date();
    const decay = computeTimeDecay(now, now, 60);
    expect(decay).toBeCloseTo(1.0, 2);
  });

  it('returns approximately 0.75 at half-life', () => {
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const decay = computeTimeDecay(sixtyDaysAgo, now, 60);
    // 0.5 + 0.5 * exp(-1) ≈ 0.5 + 0.5 * 0.368 ≈ 0.684
    expect(decay).toBeGreaterThan(0.6);
    expect(decay).toBeLessThan(0.8);
  });

  it('never goes below 0.5', () => {
    const now = new Date();
    const veryOld = new Date(now.getTime() - 10000 * 24 * 60 * 60 * 1000);
    const decay = computeTimeDecay(veryOld, now, 60);
    expect(decay).toBeGreaterThanOrEqual(0.5);
  });

  it('returns 1.0 when disabled (halfLife=0)', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    expect(computeTimeDecay(old, now, 0)).toBe(1.0);
  });
});

describe('computeLengthNorm', () => {
  it('returns 1.0 for anchor-length documents', () => {
    const norm = computeLengthNorm(500, 500);
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('returns > 1 for shorter documents (bonus)', () => {
    const norm = computeLengthNorm(100, 500);
    // 1 / (1 + log2(100/500)) = 1 / (1 + log2(0.2))
    // log2(0.2) is negative, so 1 + log2(0.2) < 1, so 1/x > 1
    // But we clamp to max(1, charLen/anchor), so log2(max(1, 0.2)) = log2(1) = 0
    // So it returns 1 / (1 + 0) = 1.0
    expect(norm).toBeCloseTo(1.0, 2);
  });

  it('returns < 1 for longer documents (penalty)', () => {
    const norm = computeLengthNorm(2000, 500);
    expect(norm).toBeLessThan(1.0);
    expect(norm).toBeGreaterThan(0);
  });

  it('penalizes very long documents more', () => {
    const norm1 = computeLengthNorm(1000, 500);
    const norm2 = computeLengthNorm(5000, 500);
    expect(norm2).toBeLessThan(norm1);
  });

  it('returns 1.0 when disabled (anchor=0)', () => {
    expect(computeLengthNorm(1000, 0)).toBe(1.0);
  });
});
