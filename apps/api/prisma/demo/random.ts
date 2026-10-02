/**
 * A seeded random generator, so every reseed builds the same demo school and
 * screenshots, tests and bug reports stay comparable.
 */
export class Random {
  private state: number;

  constructor(seed: string) {
    let h = 1779033703 ^ seed.length;
    for (let i = 0; i < seed.length; i++) {
      h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    this.state = h >>> 0;
  }

  /** 0 (inclusive) to 1 (exclusive), mulberry32. */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number from min to max, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Roughly normal, from the sum of uniforms. */
  normal(mean: number, spread: number): number {
    const sum = this.next() + this.next() + this.next() + this.next() - 2;
    return mean + sum * spread * 1.7;
  }

  shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Digits for phone numbers, CNICs and gateway references. */
  digits(length: number): string {
    return Array.from({ length }, () => this.int(0, 9)).join('');
  }
}
