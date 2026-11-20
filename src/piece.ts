import { clamp, MAX_BARS, MIN_BARS, SCENE_COUNT, TENSION_MAX, TRACK_COUNT, FIRST_ORDER, type Piece, wrap } from "./model";
import type { Random } from "./patterns";

/*
 * What a piece's tension does, bar by bar. All of it is plain arithmetic on
 * the painted line, so the same rules play live, render into a WAV and can
 * be tested without a sound card:
 *
 * - Rings come in one after another as the tension rises, in the piece's
 *   order; the first plays as soon as there is any tension at all.
 * - A ring that has only just come in plays a little quieter and without
 *   its quiet steps.
 * - The whole sound is duller when little is going on and opens up as the
 *   tension rises.
 * - Before a steep rise the Kreisel takes a run-up (rising noise) and lands
 *   with a crash; before a steep fall the last beat is thrown into the echo.
 */

/** The tension at which the ring in place `place` of the order comes in (0..1). */
export const entry = (place: number): number => 0.04 + place * 0.13;

/** How steep a step between two bars has to be for a run-up or a fall (a share of the full height). */
export const STEEP = 0.28;

export interface BarPlan {
  /** Per ring: 0 silent, otherwise how firmly it is in (up to 1). */
  gates: number[];
  /** Hz the master lowpass sits at in this bar, and where it is heading by the bar's end. */
  cutoff: number;
  cutoffEnd: number;
  /** The next bar is much higher: take a run-up through this bar. */
  rise: boolean;
  /** The next bar is much lower: throw the last beat into the echo. */
  fall: boolean;
  scene: number;
}

/** Hz of the master lowpass for a tension (0..1): open from about two thirds up. */
export function cutoffFor(tension: number): number {
  return tension >= 0.62 ? 20_000 : 900 * (20_000 / 900) ** (Math.max(0, tension) / 0.62);
}

export const barCount = (piece: Piece): number => piece.tension.length;

const share = (piece: Piece, bar: number): number => {
  const count = barCount(piece);
  return (piece.tension[wrap(bar, count)] ?? 0) / TENSION_MAX;
};

/** What bar `bar` of the piece asks for. The piece is a ring: after the last bar comes the first. */
export function planBar(piece: Piece, bar: number): BarPlan {
  const now = share(piece, bar);
  const next = share(piece, bar + 1);
  const gates = Array.from({ length: TRACK_COUNT }, () => 0);
  piece.order.forEach((ring, place) => {
    const above = now - entry(place);
    if (above >= 0) gates[ring] = clamp(0.15 + above / 0.25, 0.15, 1);
  });
  const cutoff = cutoffFor(now);
  const count = barCount(piece);
  return {
    gates,
    cutoff,
    cutoffEnd: Math.max(cutoff, cutoffFor(next)),
    rise: next - now >= STEEP && next >= 0.45,
    fall: now - next >= STEEP,
    scene: piece.scenes[wrap(bar, count)] ?? 0,
  };
}

/** A ring that has only just come in leaves its quiet steps out. */
export const dropsQuiet = (gate: number): boolean => gate < 0.45;
/** …and plays a little under its level. */
export const gateLevel = (gate: number): number => 0.72 + 0.28 * gate;

// ---- shaping the line ------------------------------------------------------------

/** A new length: the line and the scenes are stretched, not cut, so the piece keeps its shape. */
export function resizePiece(piece: Piece, bars: number): void {
  const count = clamp(Math.round(bars), MIN_BARS, MAX_BARS);
  const old = barCount(piece);
  if (count === old) return;
  const at = (index: number): number => Math.min(old - 1, Math.floor((index * old) / count));
  const tension = Array.from({ length: count }, (_, index) => piece.tension[at(index)] ?? 0);
  const scenes = Array.from({ length: count }, (_, index) => piece.scenes[at(index)] ?? 0);
  piece.tension = tension;
  piece.scenes = scenes;
}

/** Turns the piece: every bar moves `by` bars later. */
export function rotatePiece(piece: Piece, by: number): void {
  const count = barCount(piece);
  const shift = wrap(by, count);
  if (shift === 0) return;
  const turn = <T>(list: T[]): T[] => list.map((_, index) => list[(index - shift + count) % count] as T);
  piece.tension = turn(piece.tension);
  piece.scenes = turn(piece.scenes);
}

/** Rounds the line off: every bar moves halfway towards the mean of its neighbours. Steep steps soften. */
export function smoothPiece(piece: Piece): void {
  const count = barCount(piece);
  const before = [...piece.tension];
  piece.tension = before.map((value, index) => {
    const left = before[(index - 1 + count) % count] ?? value;
    const right = before[(index + 1) % count] ?? value;
    return clamp(Math.round((value * 2 + left + right) / 4), 0, TENSION_MAX);
  });
}

/** Moves a ring one place earlier (−1) or later (+1) in the order of coming in. */
export function moveInOrder(piece: Piece, ring: number, by: number): void {
  const from = piece.order.indexOf(ring);
  const to = from + by;
  if (from < 0 || to < 0 || to >= piece.order.length) return;
  piece.order[from] = piece.order[to] as number;
  piece.order[to] = ring;
}

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length) % items.length] as T;

/**
 * A new line for the piece, in sections of four or eight bars, with the form
 * of a track: it starts low and climbs, perhaps breaks, lands on a peak,
 * stays up or breaks once more, and fades out in its last section. The scenes
 * stay as they are.
 */
export function dicePiece(piece: Piece, random: Random): void {
  const count = barCount(piece);
  const lengths: number[] = [];
  for (let left = count; left > 0; left -= lengths[lengths.length - 1] ?? left) lengths.push(Math.min(left, pick(random, [4, 8, 8])));
  const sections = lengths.length;
  // The peak sits a little past the middle; a short piece ends on it.
  const peak = sections <= 2 ? sections - 1 : clamp(Math.round(sections * (0.4 + random() * 0.25)), 1, sections - 2);
  let level = 0.15 + random() * 0.15;
  const tension: number[] = [];
  lengths.forEach((length, section) => {
    let target: number;
    // A break or a peak arrives at once (that is the step that takes a run-up); the rest climbs or fades through its bars.
    let sudden = false;
    if (sections === 1) {
      target = 1;
    } else if (section < peak) {
      sudden = section === peak - 1 && section >= 1 && random() < 0.5;
      target = sudden ? 0.2 + random() * 0.12 : Math.min(0.78, level + (0.72 - level) * (0.4 + random() * 0.4));
    } else if (section === peak) {
      sudden = true;
      target = 0.94 + random() * 0.06;
    } else if (section === sections - 1 && sections >= 3) {
      target = 0.1 + random() * 0.1;
    } else {
      const turn = random();
      sudden = turn < 0.6;
      target = turn < 0.25 ? 0.25 + random() * 0.15 : 0.85 + random() * 0.15;
    }
    for (let bar = 0; bar < length; bar += 1) {
      const along = sudden ? 1 : (bar + 1) / length;
      tension.push(clamp(Math.round((level + (target - level) * along) * TENSION_MAX), 0, TENSION_MAX));
    }
    level = target;
  });
  piece.tension = tension;
}

/** The piece in words: its length and how long it lasts. */
export function describePiece(piece: Piece, bpm: number): string {
  const count = barCount(piece);
  const seconds = Math.round((count * 4 * 60) / bpm);
  const mean = Math.round((piece.tension.reduce((sum, value) => sum + value, 0) / (count * TENSION_MAX)) * 100);
  return `${count} Takte, ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Minuten, im Mittel ${mean} % Spannung`;
}

/** Whatever a link claims, a piece is 4 to 128 bars with tensions and scenes in range and every ring once in its order. */
export function soundPiece(on: boolean, tension: readonly number[], scenes: readonly number[], order: readonly number[], fallbackScene: number): Piece {
  const count = clamp(tension.length, MIN_BARS, MAX_BARS);
  const rings = order.filter((ring, index) => Number.isInteger(ring) && ring >= 0 && ring < TRACK_COUNT && order.indexOf(ring) === index);
  return {
    on,
    tension: Array.from({ length: count }, (_, index) => clamp(Math.round(tension[index] ?? 0), 0, TENSION_MAX)),
    scenes: Array.from({ length: count }, (_, index) => {
      const scene = Math.round(scenes[index] ?? fallbackScene);
      return scene >= 0 && scene < SCENE_COUNT ? scene : fallbackScene;
    }),
    order: rings.length === TRACK_COUNT ? rings : [...FIRST_ORDER],
  };
}
