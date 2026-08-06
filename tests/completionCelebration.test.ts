import { describe, expect, test } from 'vitest';
import { celebrationColors, createCelebrationParticles } from '../src/renderer/src/completionCelebration';

describe('createCelebrationParticles', () => {
  function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return state / 2147483648;
    };
  }

  test('returns the requested number of particles', () => {
    expect(createCelebrationParticles(16, seededRandom(42))).toHaveLength(16);
  });

  test('produces particles within valid ranges', () => {
    const particles = createCelebrationParticles(32, seededRandom(7));
    for (const particle of particles) {
      expect(particle.angle).toBeGreaterThanOrEqual(-0.3);
      expect(particle.angle).toBeLessThanOrEqual(Math.PI * 2 + 0.3);
      expect(particle.distance).toBeGreaterThanOrEqual(70);
      expect(particle.distance).toBeLessThan(160);
      expect(particle.size).toBeGreaterThanOrEqual(9);
      expect(particle.size).toBeLessThan(18);
      expect(particle.delay).toBeGreaterThanOrEqual(0);
      expect(particle.delay).toBeLessThan(160);
      expect(particle.rotation).toBeGreaterThanOrEqual(-270);
      expect(particle.rotation).toBeLessThanOrEqual(270);
      expect(celebrationColors).toContain(particle.color);
      expect(['star', 'dot', 'confetti']).toContain(particle.shape);
    }
  });

  test('is deterministic for a given random source', () => {
    expect(createCelebrationParticles(8, seededRandom(99))).toEqual(createCelebrationParticles(8, seededRandom(99)));
  });
});
