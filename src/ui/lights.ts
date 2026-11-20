/*
 * The light show. While the Kreisel plays, every hit throws light: a soft
 * glow on the table under the wheel in the ring's colour, a few sparks from
 * an accented hit, and from the kick a wave that runs out through the rings.
 * The glow is painted on a small canvas of its own that lies under the wheel
 * and is stretched to its size, which blurs it for free; sparks and waves
 * are drawn on the wheel. All of it is decoration: it changes nothing that
 * is heard, it can be switched off, and whoever asked for less motion never
 * sees it.
 */

/** How many sparks may fly at once, how long one lives, and how long a wave runs (seconds). */
export const MAX_SPARKS = 140;
export const SPARK_LIFE = 0.55;
export const WAVE_LIFE = 0.5;
/** How long the glow of a hit takes to fall to about a third, and after how long nothing is left of it. */
export const GLOW_FADE = 0.3;
export const GLOW_LIFE = 1.2;
/** The glow's own canvas is this many pixels wide and high, and lies this much wider than the wheel around it. */
export const AURA_SIZE = 128;
export const AURA_REACH = 1.6;

export interface Spark {
  x: number;
  y: number;
  /** Pixels a second. */
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  color: string;
}

/** The glow a hit throws on the table, in the pixels of the glow's own canvas. */
export interface Glow {
  x: number;
  y: number;
  radius: number;
  color: string;
  power: number;
  born: number;
}

export interface Wave {
  born: number;
  /** 0..1: how hard the kick was. */
  power: number;
}

/** Where a spark is at a time, and how much of it is left (1 fresh, 0 gone): it slows down as it flies. */
export function sparkAt(spark: Spark, now: number): { x: number; y: number; left: number } {
  const age = Math.max(0, now - spark.born);
  const left = Math.max(0, 1 - age / spark.life);
  // Drag: the way it has gone is the integral of a speed that falls off.
  const way = (1 - Math.exp(-3.2 * age)) / 3.2;
  return { x: spark.x + spark.vx * way, y: spark.y + spark.vy * way, left };
}

/** How far out a wave has run (0 at the hub, 1 at its end) and how strong it still is. */
export function waveAt(wave: Wave, now: number): { reach: number; left: number } {
  const t = Math.max(0, Math.min(1, (now - wave.born) / WAVE_LIFE));
  const reach = 1 - (1 - t) * (1 - t);
  return { reach, left: (1 - t) * (1 - t) * wave.power };
}

/** How much of a glow is left after `seconds`: it falls off evenly, whatever the frame rate, and is gone at the end of its life. */
export function fade(seconds: number): number {
  const age = Math.max(0, seconds);
  if (age >= GLOW_LIFE) return 0;
  return Math.exp(-age / GLOW_FADE) * (1 - age / GLOW_LIFE);
}

/** A colour written as #rrggbb, with nothing left of it; any other colour is given back as transparent black. */
export function clear(color: string): string {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(color);
  if (!hex) return "rgba(0, 0, 0, 0)";
  return `rgba(${Number.parseInt(hex[1] ?? "0", 16)}, ${Number.parseInt(hex[2] ?? "0", 16)}, ${Number.parseInt(hex[3] ?? "0", 16)}, 0)`;
}

export class Lights {
  private sparks: Spark[] = [];
  private waves: Wave[] = [];
  private glows: Glow[] = [];
  private readonly glow: CanvasRenderingContext2D | null;
  /** Something is painted on the glow's canvas. */
  private painted = false;

  constructor(aura: HTMLCanvasElement | null) {
    if (aura) {
      aura.width = AURA_SIZE;
      aura.height = AURA_SIZE;
    }
    this.glow = aura?.getContext("2d") ?? null;
  }

  /** Whether anything still moves or glows. */
  get alive(): boolean {
    return this.sparks.length > 0 || this.waves.length > 0 || this.glows.length > 0 || this.painted;
  }

  /** What flies, runs and glows right now (for the browser tests). */
  count(): { sparks: number; waves: number; glowing: boolean } {
    return { sparks: this.sparks.length, waves: this.waves.length, glowing: this.glows.length > 0 };
  }

  /**
   * A hit struck at a place of the wheel (in the wheel's own pixels, `size` across, hub at `size / 2`):
   * it glows on the table, and with `sparks` it throws that many, outward and a little along the turn.
   */
  strike(now: number, x: number, y: number, size: number, color: string, power: number, sparks: number): void {
    // The glow's canvas reaches further than the wheel: the wheel's middle is its middle.
    const scale = AURA_SIZE / (size * AURA_REACH);
    if (this.glows.length < 48) {
      this.glows.push({ x: AURA_SIZE / 2 + (x - size / 2) * scale, y: AURA_SIZE / 2 + (y - size / 2) * scale, radius: AURA_SIZE * (0.085 + 0.065 * power), color, power, born: now });
    }
    const center = size / 2;
    const out = Math.atan2(y - center, x - center);
    for (let index = 0; index < sparks && this.sparks.length < MAX_SPARKS; index += 1) {
      // Outward, fanned out, and carried a little the way the wheel turns (clockwise).
      const angle = out + (Math.random() - 0.5) * 1.5 + 0.35;
      const speed = size * (0.1 + Math.random() * 0.17) * (0.7 + 0.5 * power);
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, born: now, life: SPARK_LIFE * (0.6 + Math.random() * 0.4), size: Math.max(1.4, size * (0.0032 + Math.random() * 0.0034)), color });
    }
  }

  /** The kick struck: a wave runs out from the hub. */
  wave(now: number, power: number): void {
    if (this.waves.length < 6) this.waves.push({ born: now, power });
  }

  /** Paints the glow on the table as it is now; call once a frame. On the stage (`boost` above 1) it is wider and stronger. */
  shine(now: number, boost = 1): void {
    const glow = this.glow;
    this.glows = this.glows.filter((one) => now - one.born < GLOW_LIFE);
    if (!glow || (this.glows.length === 0 && !this.painted)) return;
    glow.clearRect(0, 0, AURA_SIZE, AURA_SIZE);
    this.painted = this.glows.length > 0;
    for (const one of this.glows) {
      const radius = one.radius * (boost > 1 ? 1.25 : 1);
      const blob = glow.createRadialGradient(one.x, one.y, 0, one.x, one.y, radius);
      // To nothing in the colour itself, so that the edge does not go grey on the way.
      blob.addColorStop(0, one.color);
      blob.addColorStop(1, clear(one.color));
      glow.globalAlpha = Math.min(1, (0.5 + 0.5 * one.power) * fade(now - one.born) * boost);
      glow.fillStyle = blob;
      glow.beginPath();
      glow.arc(one.x, one.y, radius, 0, Math.PI * 2);
      glow.fill();
    }
    glow.globalAlpha = 1;
  }

  /** Puts out everything at once (the light show was switched off). */
  clear(): void {
    if (!this.alive) return;
    this.sparks = [];
    this.waves = [];
    this.glows = [];
    this.glow?.clearRect(0, 0, AURA_SIZE, AURA_SIZE);
    this.painted = false;
  }

  /** Draws sparks and waves onto the wheel: `from` is the hub's edge, `to` the wheel's. */
  draw(context: CanvasRenderingContext2D, now: number, center: number, from: number, to: number, ink: string): void {
    this.waves = this.waves.filter((wave) => now - wave.born < WAVE_LIFE);
    for (const wave of this.waves) {
      const { reach, left } = waveAt(wave, now);
      context.beginPath();
      context.arc(center, center, from + (to - from) * (0.25 + 0.75 * wave.power) * reach, 0, Math.PI * 2);
      context.strokeStyle = ink;
      context.globalAlpha = 0.34 * left;
      context.lineWidth = 1.5 + 3.5 * left;
      context.stroke();
    }
    this.sparks = this.sparks.filter((spark) => now - spark.born < spark.life);
    for (const spark of this.sparks) {
      const { x, y, left } = sparkAt(spark, now);
      context.beginPath();
      context.arc(x, y, spark.size * (0.5 + 0.5 * left), 0, Math.PI * 2);
      context.fillStyle = spark.color;
      context.globalAlpha = Math.min(1, left * 1.6);
      context.fill();
    }
    context.globalAlpha = 1;
  }
}
