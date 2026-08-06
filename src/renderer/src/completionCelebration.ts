export interface CelebrationParticle {
  /** Launch direction in radians, 0 = right, positive = counter-clockwise. */
  angle: number;
  /** Flight distance in px before pet-ui scaling is applied. */
  distance: number;
  /** Particle size in px. */
  size: number;
  color: string;
  /** Animation delay in ms. */
  delay: number;
  /** End-of-flight rotation in degrees (confetti spin). */
  rotation: number;
  shape: 'star' | 'dot' | 'confetti';
}

export const celebrationColors = ['#ff5b8d', '#ffb020', '#3ddc84', '#40a9ff', '#b65ad8', '#ff7a45', '#1d9aa8', '#f6e05e'];

/**
 * Builds the particle parameters for one completion burst. Pure and DOM-free;
 * `random` is injectable so tests can assert deterministic output. Particles
 * fan out across a full circle with a slight downward bias for a gravity feel.
 */
export function createCelebrationParticles(
  count: number,
  random: () => number = Math.random
): CelebrationParticle[] {
  const particles: CelebrationParticle[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * 0.6;
    const shapeRoll = random();
    particles.push({
      angle,
      distance: 70 + random() * 90,
      size: 9 + random() * 9,
      color: celebrationColors[Math.floor(random() * celebrationColors.length)],
      delay: random() * 160,
      rotation: (random() - 0.5) * 540,
      shape: shapeRoll < 0.35 ? 'star' : shapeRoll < 0.7 ? 'confetti' : 'dot'
    });
  }
  return particles;
}
