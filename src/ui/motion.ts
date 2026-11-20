import { PITCH_MIN, type Step } from "../model";

/*
 * How things move. Kreisel is a tin toy on a paper table: what appears hops
 * into place with a little overshoot, what goes shrinks away quickly, what
 * is pressed gives way. Nothing floats and nothing takes long. This file
 * holds the curves and the question "what has changed on a ring", so that
 * the wheel can answer a change with the motion that fits it: a hit that
 * was set pops in, one that was taken shrinks away, a ring that was turned
 * slides, and a ring that was diced deals its hits around the circle.
 */

/** How long a hit takes to pop in, to shrink away, to swell once, and a turned ring to slide into place (seconds). */
export const POP = 0.2;
export const SHRINK = 0.13;
export const SWELL = 0.22;
export const SLIDE = 0.16;
/** How long dealing a whole ring takes, from its first step to its last. */
export const DEAL = 0.22;
/** From this many hits coming or going at once, a ring deals them one after another. */
export const MANY = 4;

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** 0 → 1 with a little overshoot on the way: something hops into place. */
export function hop(t: number): number {
  const x = clamp01(t) - 1;
  const spring = 2.2;
  return 1 + (spring + 1) * x * x * x + spring * x * x;
}

/** 0 → 1, quick at first and gentle at the end: something comes to rest. */
export function rest(t: number): number {
  const x = 1 - clamp01(t);
  return 1 - x * x * x;
}

/** 0 → 1 → 0: one swell. */
export function swell(t: number): number {
  return Math.sin(Math.PI * clamp01(t));
}

/** Moves a share of the way to a target, frame by frame; close to it, it is there. */
export function approach(from: number, to: number, share: number): number {
  return Math.abs(to - from) < 0.004 ? to : from + (to - from) * share;
}

/** What a step looks like, as one number; 0 is no hit. The low byte is the hit and its accent, chance and roll. */
export function face(step: Step): number {
  if (!step.on) return 0;
  return 1 | ((step.vel & 3) << 1) | ((step.chance & 3) << 3) | ((step.ratchet & 7) << 5) | (((step.pitch - PITCH_MIN) & 63) << 8) | ((step.len & 31) << 14);
}

/** The step a face was taken from, as far as drawing it goes. */
export function unface(value: number): Step {
  return { on: (value & 1) === 1, vel: (value >> 1) & 3, chance: (value >> 3) & 3, ratchet: (value >> 5) & 7, pitch: ((value >> 8) & 63) + PITCH_MIN, len: (value >> 14) & 31 };
}

export interface RingChange {
  /** Steps a hit appeared on, steps a hit left, and steps whose accent, chance or roll changed. */
  born: number[];
  gone: number[];
  nudged: number[];
  /** The ring was turned by this many steps, clockwise (then nothing else is reported). */
  turned: number;
}

/** What happened to a ring between two looks at it. A hit that only changed its pitch or length has not changed here. */
export function compare(before: readonly number[], after: readonly number[]): RingChange {
  const change: RingChange = { born: [], gone: [], nudged: [], turned: 0 };
  const length = after.length;
  if (before.length === length && length > 1) {
    let same = true;
    for (let index = 0; index < length && same; index += 1) same = before[index] === after[index];
    if (same) return change;
    for (const by of [1, -1, 2, -2]) {
      let turned = true;
      for (let index = 0; index < length && turned; index += 1) turned = after[index] === before[(((index - by) % length) + length) % length];
      if (turned) {
        change.turned = by;
        return change;
      }
    }
  }
  const longest = Math.max(before.length, length);
  for (let index = 0; index < longest; index += 1) {
    const was = index < before.length ? (before[index] ?? 0) : 0;
    const is = index < length ? (after[index] ?? 0) : 0;
    if (was === 0 && is !== 0) change.born.push(index);
    else if (was !== 0 && is === 0) change.gone.push(index);
    else if ((was & 0xff) !== (is & 0xff)) change.nudged.push(index);
  }
  return change;
}

/** How much later than the first a step's hit is dealt, when a whole ring changes at once. */
export function dealt(index: number, length: number): number {
  return (index / Math.max(1, length)) * DEAL;
}
