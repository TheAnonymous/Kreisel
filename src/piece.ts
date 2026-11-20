import { clamp, MAX_BARS, MIN_BARS, SCENE_COUNT, TENSION_MAX, TRACK_COUNT, FIRST_ORDER, type Piece, type StyleId, wrap } from "./model";
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

/** A stretch of a techno track. */
export interface Section {
  role: "intro" | "full" | "break" | "outro";
  bars: number;
}

/** The shortest piece that has room for a techno form: an intro and an outro of eight bars. */
export const TECHNO_FORM_MIN = 16;

/**
 * The sections of a techno track over `count` bars, each as a role and a
 * length. Sections are 16 or 32 bars long (8 or 16 in a piece under 64 bars):
 * an intro, then full sections with a break between them, and an outro. Bars
 * that do not fill a section go to the last full one.
 */
export function technoSections(count: number, random: Random): Section[] {
  const unit = count >= 64 ? 16 : 8;
  const units = Math.floor(count / unit);
  const sections: Section[] = [{ role: "intro", bars: unit }];
  // What lies between intro and outro, counted in units: two full, one break, two full … and whatever is left at the end.
  let left = units - 2;
  while (left >= 5) {
    sections.push({ role: "full", bars: unit * 2 }, { role: "break", bars: unit });
    left -= 3;
  }
  const tail: readonly (readonly [role: "full" | "break", units: number])[] = left === 4
    ? (random() < 0.5 ? [["full", 2], ["break", 1], ["full", 1]] : [["full", 1], ["break", 1], ["full", 2]])
    : left === 3 ? [["full", 1], ["break", 1], ["full", 1]]
      : left > 0 ? [["full", left]] : [];
  for (const [role, long] of tail) sections.push({ role, bars: long * unit });
  sections.push({ role: "outro", bars: unit });
  // The rest goes to the last full section, or to the intro where there is none.
  const rest = count - units * unit;
  const grows = [...sections].reverse().find((section) => section.role === "full") ?? sections[0];
  if (grows) grows.bars += rest;
  return sections;
}

/**
 * A techno form for the line. The intro climbs from the kick alone until four
 * rings play. A full section arrives at once (which takes a run-up) and lifts
 * a little at its half. A break falls at once and climbs again through its
 * second half. The outro takes the piece apart, ring by ring.
 */
function technoLine(count: number, random: Random): number[] {
  const between = (low: number, high: number): number => low + random() * (high - low);
  const tension: number[] = [];
  let fulls = 0;
  for (const { role, bars } of technoSections(count, random)) {
    let from: number;
    let to: number;
    if (role === "intro") [from, to] = [between(0.06, 0.12), between(0.44, 0.52)];
    else if (role === "outro") [from, to] = [between(0.7, 0.8), between(0.06, 0.12)];
    else if (role === "break") [from, to] = [between(0.2, 0.3), between(0.5, 0.62)];
    else {
      fulls += 1;
      // The first full section holds something back for the ones after it.
      from = fulls === 1 ? between(0.84, 0.9) : between(0.92, 1);
      to = Math.min(1, from + 0.07);
    }
    for (let bar = 0; bar < bars; bar += 1) {
      const level = role === "full" ? (bar < bars / 2 ? from : to)
        : role === "break" ? (bar < bars / 2 ? from : from + ((to - from) * (bar - bars / 2 + 1)) / (bars / 2))
          : from + ((to - from) * bar) / Math.max(1, bars - 1);
      tension.push(clamp(Math.round(level * TENSION_MAX), 0, TENSION_MAX));
    }
  }
  return tension;
}

/**
 * A new line for the piece, with the form of a track. In the free style it
 * comes in sections of four or eight bars: it starts low and climbs, perhaps
 * breaks, lands on a peak, stays up or breaks once more, and fades out in its
 * last section. In techno it is a techno form (see `technoSections`), where
 * the piece is long enough for one. The scenes stay as they are.
 */
export function dicePiece(piece: Piece, random: Random, style: StyleId = "frei"): void {
  const count = barCount(piece);
  if (style === "techno" && count >= TECHNO_FORM_MIN) {
    piece.tension = technoLine(count, random);
    return;
  }
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

/** Whatever a link claims, a piece is 4 to 256 bars with tensions and scenes in range and every ring once in its order. */
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
