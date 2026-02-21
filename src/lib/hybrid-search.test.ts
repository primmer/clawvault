import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion, cosineSimilarity, EmbeddingCache } from './hybrid-search.js';

describe('reciprocalRankFusion', () => {
  it('fuses two ranked lists', () => {
    const list1 = [
      { id: 'a', score: 10 },
      { id: 'b', score: 8 },
      { id: 'c', score: 5 },
    ];
    const list2 = [
      { id: 'b', score: 0.9 },
      { id: 'd', score: 0.8 },
      { id: 'a', score: 0.7 },
    ];
    const result = reciprocalRankFusion(list1, list2, 60);
    // 'b' appears in both lists (rank 1 in list1, rank 0 in list2) — should be top
    expect(result[0].id).toBe('b');
    // 'a' also in both
    expect(result[1].id).toBe('a');
    // All 4 unique items present
    expect(result.length).toBe(4);
  });

  it('handles empty lists', () => {
    const result = reciprocalRankFusion([], [], 60);
    expect(result).toEqual([]);
  });
});

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = new Float32Array([0.5, 0.5, 0.5, 0.5]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 2);
  });

  it('returns ~0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 2);
  });
});
