import { clamp, HEIGHT_MAX, MAX_STROKE_POINTS, TIME_MAX, trackInfo, type Bild, type Stroke } from "./model";
import type { Random } from "./patterns";

/*
 * Painted sounds. A picture is read like a score that anyone can draw: time
 * runs from left to right, pitch from bottom to top. Every stroke of the
 * brush is one tone (or one hiss). It is loudest where the brush was set
 * down and fades as the paint runs out; a stroke painted from right to left
 * swells instead. Pure geometry here; `audio/bild.ts` makes it sound.
 */

const LOW_HZ = 27.5;
const OCTAVES = 9;

/** The pitch a height stands for: 27.5 Hz at the bottom, nine octaves up at the top. */
export const heightToHz = (y: number): number => LOW_HZ * 2 ** ((y / HEIGHT_MAX) * OCTAVES);

export const hzToHeight = (hz: number): number => clamp(Math.round((Math.log2(Math.max(1, hz) / LOW_HZ) / OCTAVES) * HEIGHT_MAX), 0, HEIGHT_MAX);

/** One semitone in units of height. */
export const SEMITONE = HEIGHT_MAX / (OCTAVES * 12);

export const BRUSHES = ["Summen", "Sägen", "Zischen"] as const;

export interface Guide {
  y: number;
  label: string;
  /** The line a ring's notes are painted on. */
  root: boolean;
}

/**
 * The lines across a picture. A ring that plays notes has its root and the
 * overtones above it (strokes on them stay in tune with every note); a drum
 * has plain octaves to find one's way.
 */
export function guides(track: number): Guide[] {
  const ref = trackInfo(track).refHz;
  if (ref > 0) {
    return [0.5, 1, 2, 3, 4, 5, 6, 8].map((multiple) => ({
      y: hzToHeight(ref * multiple),
      label: multiple === 1 ? "Grundton" : multiple === 2 ? "Oktave" : "",
      root: multiple === 1,
    }));
  }
  return [55, 110, 220, 440, 880, 1760, 3520, 7040].map((hz) => ({ y: hzToHeight(hz), label: "", root: false }));
}

/** Tones painted near an overtone line of a ring that plays notes stick to it, so they are in tune. */
export function snapHeight(track: number, kind: number, y: number): number {
  if (kind === 2 || trackInfo(track).refHz <= 0) return y;
  let best = y;
  let nearest = SEMITONE * 1.6;
  for (const guide of guides(track)) {
    const distance = Math.abs(guide.y - y);
    if (distance < nearest) {
      nearest = distance;
      best = guide.y;
    }
  }
  return best;
}

export interface RawPoint {
  /** 0..1 from left to right. */
  t: number;
  /** 0..1 from bottom to top. */
  y: number;
}

/** Leaves out points that lie (nearly) on the line between their neighbours (Ramer–Douglas–Peucker). */
function simplify(points: readonly RawPoint[], tolerance: number): RawPoint[] {
  if (points.length <= 2) return [...points];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const dt = last.t - first.t;
  const dy = last.y - first.y;
  const length = Math.hypot(dt, dy);
  let worst = 0;
  let index = 0;
  for (let at = 1; at < points.length - 1; at += 1) {
    const point = points[at]!;
    const distance = length === 0 ? Math.hypot(point.t - first.t, point.y - first.y) : Math.abs(dy * (point.t - first.t) - dt * (point.y - first.y)) / length;
    if (distance > worst) {
      worst = distance;
      index = at;
    }
  }
  if (worst <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

/**
 * A stroke from the points the brush passed, in the order it passed them.
 * Time cannot run backwards inside a sound: the direction of the first move
 * decides whether the stroke fades (left to right) or swells (right to left),
 * and wherever the hand turns back, the stroke only moves in pitch.
 */
export function makeStroke(kind: number, size: number, drawn: readonly RawPoint[], snap: (y: number) => number = (y) => y): Stroke | null {
  const first = drawn[0];
  const last = drawn[drawn.length - 1];
  if (!first || !last) return null;
  const swell = last.t < first.t - 0.004;
  const ordered = swell ? [...drawn].reverse() : drawn;
  let time = clamp(ordered[0]?.t ?? 0, 0, 1);
  // Snapped before thinning out, so a stroke along a line becomes two points, not a row of them.
  const forward = ordered.map((point) => {
    time = Math.max(time, clamp(point.t, 0, 1));
    return { t: time, y: clamp(snap(clamp(point.y, 0, 1) * HEIGHT_MAX) / HEIGHT_MAX, 0, 1) };
  });
  let tolerance = 0.004;
  let simple = simplify(forward, tolerance);
  while (simple.length > MAX_STROKE_POINTS) {
    tolerance *= 1.6;
    simple = simplify(forward, tolerance);
  }
  const points: number[] = [];
  for (const point of simple) {
    const t = Math.round(point.t * TIME_MAX);
    const y = clamp(Math.round(point.y * HEIGHT_MAX), 0, HEIGHT_MAX);
    const count = points.length;
    if (count >= 2 && points[count - 2] === t && points[count - 1] === y) continue;
    points.push(t, y);
  }
  return { kind: clamp(Math.round(kind), 0, 2), size: clamp(Math.round(size), 0, 2), swell, points };
}

/** How loud a stroke is at share `along` of its way (0 at its left end, 1 at its right): paint running out, or coming on. */
export function strokeLevel(stroke: Stroke, along: number): number {
  const share = clamp(stroke.swell ? along : 1 - along, 0, 1);
  return share ** 1.6;
}

export function pointCount(stroke: Stroke): number {
  return stroke.points.length >> 1;
}

/** The stroke under a point of the picture (both 0..1), within `reach` (a share of the picture's height); −1 if none. */
export function strokeAt(bild: Bild, t: number, y: number, reach: number, aspect = 2): number {
  let best = -1;
  let nearest = reach;
  bild.strokes.forEach((stroke, index) => {
    const count = pointCount(stroke);
    for (let at = 0; at < count; at += 1) {
      // Distances in units of the picture's height, so `reach` means the same in both directions.
      const ax = ((stroke.points[at * 2] ?? 0) / TIME_MAX) * aspect;
      const ay = (stroke.points[at * 2 + 1] ?? 0) / HEIGHT_MAX;
      const next = Math.min(count - 1, at + 1);
      const bx = ((stroke.points[next * 2] ?? 0) / TIME_MAX) * aspect;
      const by = (stroke.points[next * 2 + 1] ?? 0) / HEIGHT_MAX;
      const px = t * aspect;
      const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
      const share = lengthSquared === 0 ? 0 : clamp(((px - ax) * (bx - ax) + (y - ay) * (by - ay)) / lengthSquared, 0, 1);
      const distance = Math.hypot(px - (ax + share * (bx - ax)), y - (ay + share * (by - ay)));
      if (distance < nearest) {
        nearest = distance;
        best = index;
      }
    }
  });
  return best;
}

export function emptyBild(): Bild {
  return { strokes: [], hold: null };
}

/** The picture in words, for the status line and screen readers. */
export function describeBild(bild: Bild | null): string {
  const count = bild?.strokes.length ?? 0;
  if (count === 0) return "noch leer";
  const kinds = BRUSHES.map((name, kind) => {
    const of = bild?.strokes.filter((stroke) => stroke.kind === kind).length ?? 0;
    return of > 0 ? `${of}× ${name}` : "";
  }).filter(Boolean);
  return `${count} ${count === 1 ? "Strich" : "Striche"} (${kinds.join(", ")})`;
}

// ---- dice: a first picture in the manner of each ring -------------------------

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length) % items.length] as T;
const between = (random: Random, low: number, high: number): number => low + random() * (high - low);

/** A stroke through (time 0..1, Hz) points, as painted from left to right (or `swell`). */
function line(kind: number, size: number, through: readonly (readonly [number, number])[], swell = false): Stroke {
  const points: number[] = [];
  for (const [t, hz] of through) points.push(Math.round(clamp(t, 0, 1) * TIME_MAX), hzToHeight(hz));
  return { kind, size, swell, points };
}

function diceKick(random: Random): Bild {
  const bottom = pick(random, [44, 49, 55]);
  const top = pick(random, [170, 230, 320, 700]);
  const length = between(random, 0.3, 0.7);
  const strokes = [line(0, 2, [[0, top], [between(random, 0.03, 0.07), bottom * 1.5], [0.13, bottom], [length, bottom * 0.94]])];
  if (random() < 0.7) strokes.push(line(2, 0, [[0, between(random, 2500, 5000)], [0.02, 2400]]));
  if (random() < 0.4) strokes.push(line(1, 0, [[0, 110], [0.07, 62]]));
  return { strokes, hold: null };
}

function diceSnare(random: Random): Bild {
  const strokes = [
    line(0, 1, [[0, between(random, 230, 300)], [0.05, 185], [between(random, 0.12, 0.2), 172]]),
    line(2, 2, [[0, between(random, 3200, 6000)], [between(random, 0.2, 0.42), between(random, 2400, 4200)]]),
  ];
  if (random() < 0.5) strokes.push(line(2, 0, [[0, 8500], [between(random, 0.08, 0.2), 8000]]));
  return { strokes, hold: null };
}

function diceHat(random: Random): Bild {
  const open = random() < 0.3;
  const high = between(random, 7500, 11_000);
  const strokes = [line(2, open ? 1 : 2, [[0, high], [open ? between(random, 0.3, 0.5) : between(random, 0.05, 0.11), high * 0.95]])];
  if (random() < 0.5) strokes.push(line(2, 0, [[0, 5200], [between(random, 0.03, 0.08), 5000]]));
  if (random() < 0.35) strokes.push(line(1, 0, [[0, between(random, 5800, 6800)], [0.04, 6000]]));
  return { strokes, hold: null };
}

function dicePerc(random: Random): Bild {
  const style = pick(random, ["tom", "tom", "wood", "bell"] as const);
  if (style === "wood") {
    return { strokes: [line(0, 2, [[0, 880], [between(random, 0.04, 0.07), 870]]), line(0, 1, [[0, 594], [0.03, 590]]), line(2, 0, [[0, 3000], [0.015, 2800]])], hold: null };
  }
  if (style === "bell") {
    const ring = between(random, 0.25, 0.5);
    return { strokes: [line(1, 1, [[0, 440], [ring, 440]]), line(1, 1, [[0, 652], [ring * 0.8, 652]]), line(0, 0, [[0, 1320], [ring * 0.4, 1320]])], hold: null };
  }
  const body = between(random, 190, 240);
  return { strokes: [line(0, 2, [[0, body * 1.25], [0.06, body], [between(random, 0.22, 0.45), body * 0.92]]), line(2, 0, [[0, 2200], [0.02, 2000]])], hold: null };
}

function diceBass(random: Random): Bild {
  const buzz = random() < 0.55;
  const length = between(random, 0.55, 0.9);
  const strokes = [line(buzz ? 1 : 0, 2, [[0, 55], [length, 55]])];
  if (buzz) strokes.push(line(0, 2, [[0, 55], [length * 0.9, 55]]));
  strokes.push(line(0, 1, [[0, 110], [between(random, 0.15, 0.4), 110]]));
  if (random() < 0.5) strokes.push(line(1, 0, [[0, 165], [between(random, 0.06, 0.14), 165]]));
  return { strokes, hold: random() < 0.6 ? Math.round(between(random, 0.22, 0.4) * TIME_MAX) : null };
}

function diceChord(random: Random): Bild {
  if (random() < 0.35) {
    // A pad: every voice swells in, then slowly runs dry.
    const peak = between(random, 0.25, 0.4);
    return {
      strokes: [line(0, 2, [[0, 220], [peak, 220]], true), line(0, 2, [[peak, 220], [1, 220]]), line(0, 1, [[0, 440], [peak, 440]], true), line(0, 1, [[peak, 440], [0.9, 440]]), line(1, 0, [[peak * 0.6, 220], [0.8, 220]])],
      hold: Math.round((peak + 0.05) * TIME_MAX),
    };
  }
  const strokes = [line(0, 2, [[0, 220], [between(random, 0.6, 0.9), 220]]), line(0, 1, [[0, 440], [between(random, 0.35, 0.6), 440]]), line(0, 0, [[0, 660], [between(random, 0.15, 0.35), 660]])];
  if (random() < 0.5) strokes.push(line(1, 0, [[0, 220], [between(random, 0.2, 0.7), 220]]));
  return { strokes, hold: random() < 0.5 ? Math.round(between(random, 0.2, 0.35) * TIME_MAX) : null };
}

function diceLead(random: Random): Bild {
  const length = between(random, 0.45, 0.9);
  const scoop = random() < 0.4;
  const strokes = [scoop ? line(0, 2, [[0, 440 * 0.9], [0.05, 440], [length, 440]]) : line(0, 2, [[0, 440], [length, 440]])];
  strokes.push(line(1, pick(random, [0, 1]), [[0, 880], [between(random, 0.1, 0.3), 880]]));
  if (random() < 0.5) strokes.push(line(0, 0, [[0, 1320], [between(random, 0.08, 0.25), 1320]]));
  if (random() < 0.3) strokes.push(line(2, 0, [[0, 5000], [0.03, 4500]]));
  return { strokes, hold: random() < 0.5 ? Math.round(between(random, 0.2, 0.35) * TIME_MAX) : null };
}

const DICE = [diceKick, diceSnare, diceHat, dicePerc, diceBass, diceChord, diceLead] as const;

/** A first picture for a ring: what its instrument usually looks like, a little different every time. */
export function diceBild(track: number, random: Random): Bild {
  return (DICE[track] ?? diceKick)(random);
}
