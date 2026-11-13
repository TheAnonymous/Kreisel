import { clamp, emptyPattern, emptyStep, MAX_NOTE_LENGTH, MAX_STEPS, PITCH_MAX, PITCH_MIN, stepAt, TRACK_KINDS, type Pattern, type Step, type TrackKind } from "./model";

/*
 * What can be done to a ring as a whole: turn it, spread its hits evenly,
 * roll the dice for a new idea or change it just a little. All pure, with a
 * seeded generator, so the dice can be tested.
 */

export type Random = () => number;

/** A small seeded generator (mulberry32). */
export function seeded(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pick = <T>(random: Random, items: readonly T[]): T => items[Math.floor(random() * items.length) % items.length] as T;
const chance = (random: Random, share: number): boolean => random() < share;

export function activeSteps(pattern: Pattern): number[] {
  const result: number[] = [];
  for (let index = 0; index < pattern.len; index += 1) if (stepAt(pattern, index).on) result.push(index);
  return result;
}

/** Turns the ring: every hit moves `by` steps clockwise. */
export function rotate(pattern: Pattern, by: number): void {
  const len = pattern.len;
  const shift = ((by % len) + len) % len;
  if (shift === 0) return;
  const visible = pattern.steps.slice(0, len);
  for (let index = 0; index < len; index += 1) {
    pattern.steps[(index + shift) % len] = visible[index] ?? emptyStep();
  }
}

/** `hits` spread as evenly as possible over `length` steps (a Euclidean rhythm), starting on the first step. */
export function euclid(hits: number, length: number): boolean[] {
  const count = clamp(Math.round(hits), 0, length);
  return Array.from({ length }, (_, index) => count > 0 && Math.floor((index * count) / length) !== Math.floor(((index - 1) * count) / length));
}

/** Spreads `hits` evenly over the ring, starting where its first hit is. Hits that stay keep what they had. */
export function spread(pattern: Pattern, hits: number): void {
  const first = activeSteps(pattern)[0] ?? 0;
  const template = pattern.steps.slice(0, pattern.len).find((step) => step.on) ?? emptyStep();
  const shape = euclid(hits, pattern.len);
  for (let index = 0; index < pattern.len; index += 1) {
    const step = stepAt(pattern, (index + first) % pattern.len);
    const on = shape[index] ?? false;
    if (on && !step.on) Object.assign(step, { ...emptyStep(), on: true, pitch: template.pitch });
    else if (!on) step.on = false;
  }
}

export function transpose(pattern: Pattern, by: number): void {
  for (const step of pattern.steps) if (step.on) step.pitch = clamp(step.pitch + by, PITCH_MIN, PITCH_MAX);
}

export function clear(pattern: Pattern): void {
  for (const step of pattern.steps) step.on = false;
}

/** Changes the ring's length; steps beyond it are kept for when it grows again. */
export function resize(pattern: Pattern, len: number): void {
  pattern.len = clamp(Math.round(len), 2, MAX_STEPS);
}

function put(pattern: Pattern, index: number, values: Partial<Step> = {}): void {
  if (index < 0 || index >= pattern.len) return;
  Object.assign(stepAt(pattern, index), { ...emptyStep(), on: true, ...values });
}

/** Where a ring of any length has its beats: every fourth step, as far as they fit. */
const beats = (len: number): number[] => Array.from({ length: Math.ceil(len / 4) }, (_, index) => index * 4).filter((index) => index < len);

function diceKick(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  const style = pick(random, ["four", "four", "broken", "half", "even"] as const);
  if (style === "four") {
    for (const beat of beats(len)) put(pattern, beat, { vel: beat % 8 === 0 ? 2 : 1 });
    if (chance(random, 0.45)) put(pattern, len - pick(random, [1, 2, 3]), { vel: 0 });
    if (chance(random, 0.25)) put(pattern, pick(random, [3, 7, 11]), { vel: 0 });
  } else if (style === "broken") {
    put(pattern, 0, { vel: 2 });
    for (const index of [3, 6, 7, 10, 11, 14]) if (chance(random, 0.38)) put(pattern, index, { vel: chance(random, 0.3) ? 0 : 1 });
    if (len > 8) put(pattern, pick(random, [8, 10]), { vel: 1 });
  } else if (style === "half") {
    put(pattern, 0, { vel: 2 });
    if (chance(random, 0.6)) put(pattern, pick(random, [3, 6, 7]));
    put(pattern, Math.min(len - 1, 10));
  } else {
    const shape = euclid(pick(random, [3, 5]), len);
    shape.forEach((on, index) => { if (on) put(pattern, index, { vel: index === 0 ? 2 : 1 }); });
  }
  return pattern;
}

function diceSnare(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  const half = chance(random, 0.2);
  for (const beat of beats(len)) {
    if (half ? beat % 16 === 8 : beat % 8 === 4) put(pattern, beat, { vel: 2 });
  }
  for (let index = 0; index < len; index += 1) {
    if (!stepAt(pattern, index).on && index % 2 === 1 && chance(random, 0.12)) put(pattern, index, { vel: 0, chance: chance(random, 0.5) ? 2 : 0 });
  }
  if (chance(random, 0.35)) put(pattern, len - 1, { vel: 1, ratchet: chance(random, 0.4) ? 2 : 1 });
  if (activeSteps(pattern).length === 0) put(pattern, Math.floor(len / 2), { vel: 2 });
  return pattern;
}

function diceHat(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  const style = pick(random, ["eighths", "sixteenths", "offbeat", "offbeat", "sparse"] as const);
  for (let index = 0; index < len; index += 1) {
    const offbeat = index % 4 === 2;
    if (style === "eighths" && index % 2 === 0) put(pattern, index, { vel: offbeat ? 1 : 0 });
    if (style === "sixteenths") put(pattern, index, { vel: offbeat ? 2 : index % 2 === 0 ? 1 : 0, chance: index % 2 === 1 && chance(random, 0.3) ? 1 : 0 });
    if (style === "offbeat" && offbeat) put(pattern, index, { vel: 1, pitch: chance(random, 0.5) ? 3 : 0 });
    if (style === "sparse" && chance(random, 0.3)) put(pattern, index, { vel: chance(random, 0.5) ? 0 : 1 });
  }
  if (style !== "offbeat" && chance(random, 0.6)) {
    const open = pick(random, [len - 2, len - 6, 6, 14].filter((index) => index >= 0 && index < len));
    put(pattern, open, { vel: 1, pitch: pick(random, [2, 3, 4]) });
  }
  if (chance(random, 0.3)) {
    const roll = pick(random, activeSteps(pattern));
    if (roll !== undefined) stepAt(pattern, roll).ratchet = pick(random, [2, 3]);
  }
  return pattern;
}

function dicePerc(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  const shape = euclid(pick(random, [2, 3, 3, 4, 5]), len);
  const turn = Math.floor(random() * len);
  const tones = [0, 2, 4, 2, 0, -3, 4, 7];
  shape.forEach((on, index) => {
    if (on) put(pattern, (index + turn) % len, { pitch: pick(random, tones), vel: chance(random, 0.3) ? 0 : 1, chance: chance(random, 0.2) ? 1 : 0 });
  });
  return pattern;
}

function diceBass(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  const style = pick(random, ["pulse", "offbeat", "walk", "sync", "sync"] as const);
  const tones = [0, 0, 0, 7, 4, 2, -3];
  if (style === "pulse") {
    for (let index = 0; index < len; index += 2) put(pattern, index, { pitch: index % 8 === 6 && chance(random, 0.6) ? 7 : 0, vel: index % 4 === 0 ? 1 : 0 });
  } else if (style === "offbeat") {
    for (let index = 2; index < len; index += 4) put(pattern, index, { pitch: chance(random, 0.25) ? 7 : 0, len: 2 });
  } else if (style === "walk") {
    let pitch = 0;
    for (let index = 0; index < len; index += 4) {
      put(pattern, index, { pitch, len: 3, vel: index === 0 ? 2 : 1 });
      pitch = clamp(pitch + pick(random, [-2, -1, 1, 2, 2, 4]), -3, 7);
    }
  } else {
    put(pattern, 0, { pitch: 0, len: 2, vel: 2 });
    for (const index of [3, 6, 8, 10, 11, 14, 19, 22, 24, 27, 30]) {
      if (index < len && chance(random, 0.48)) put(pattern, index, { pitch: pick(random, tones), len: chance(random, 0.3) ? 2 : 1, vel: chance(random, 0.25) ? 0 : 1 });
    }
  }
  return pattern;
}

function diceChord(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  const style = pick(random, ["held", "stabs", "sync", "pulse"] as const);
  const lage = pick(random, [0, 0, 1, 2]);
  if (style === "held") {
    for (let index = 0; index < len; index += 16) put(pattern, index, { pitch: lage, len: Math.min(MAX_NOTE_LENGTH, len - index, 14) });
    if (chance(random, 0.4) && len > 10) put(pattern, 10, { pitch: lage + 1, len: 4, vel: 0 });
  } else if (style === "stabs") {
    for (let index = 2; index < len; index += 4) put(pattern, index, { pitch: lage, vel: index % 8 === 6 ? 2 : 1 });
  } else if (style === "sync") {
    for (const index of [0, 3, 6, 11, 14, 16, 19, 22, 27, 30]) {
      if (index < len && (index === 0 || chance(random, 0.6))) put(pattern, index, { pitch: lage + (chance(random, 0.2) ? 1 : 0), len: 2 });
    }
  } else {
    for (let index = 0; index < len; index += 4) put(pattern, index, { pitch: lage, len: 2, vel: index % 8 === 0 ? 1 : 0 });
  }
  return pattern;
}

function diceLead(len: number, random: Random): Pattern {
  const pattern = emptyPattern(len);
  // A motif of eight steps, answered by itself with a twist: it sounds meant.
  const motif: (Partial<Step> | null)[] = [];
  let pitch = pick(random, [0, 2, 4, 4, 7]);
  for (let index = 0; index < 8; index += 1) {
    const strong = index % 2 === 0;
    if (chance(random, strong ? 0.62 : 0.24)) {
      motif.push({ pitch, len: chance(random, 0.3) ? 2 : 1, vel: index === 0 ? 2 : chance(random, 0.25) ? 0 : 1 });
      pitch = clamp(pitch + pick(random, [-2, -1, -1, 1, 1, 2, 3, -3]), -2, 11);
    } else {
      motif.push(null);
    }
  }
  if (!motif.some((note) => note !== null)) motif[0] = { pitch: 4, len: 2 };
  for (let index = 0; index < len; index += 1) {
    const note = motif[index % 8];
    if (!note) continue;
    const answer = Math.floor(index / 8) % 2 === 1;
    const twist = answer && index % 8 >= 5 ? pick(random, [-1, 0, 1, 2]) : 0;
    put(pattern, index, { ...note, pitch: clamp((note.pitch ?? 0) + twist, PITCH_MIN, PITCH_MAX) });
  }
  return pattern;
}

const DICE: Record<TrackKind, (len: number, random: Random) => Pattern> = {
  kick: diceKick,
  snare: diceSnare,
  hat: diceHat,
  perc: dicePerc,
  bass: diceBass,
  chord: diceChord,
  lead: diceLead,
};

/** A new idea for a ring of `len` steps, in the manner of its instrument. */
export function dice(track: number, len: number, random: Random): Pattern {
  const pattern = DICE[TRACK_KINDS[track] ?? "kick"](len, random);
  // Very short rings can miss every place a style would use: they still get their first step.
  if (activeSteps(pattern).length === 0) put(pattern, 0, { pitch: track === 6 ? 4 : 0 });
  return pattern;
}

/** A small change: one hit moves, one comes or goes, one note steps up or down. */
export function vary(track: number, pattern: Pattern, random: Random): void {
  const melodic = track >= 3;
  const hits = activeSteps(pattern);
  if (hits.length === 0) {
    put(pattern, Math.floor(random() * pattern.len));
    return;
  }
  const moves = melodic ? (["pitch", "pitch", "move", "add", "drop", "feel"] as const) : (["move", "add", "drop", "feel", "feel"] as const);
  const move = pick(random, moves);
  const index = pick(random, hits);
  const step = stepAt(pattern, index);
  if (move === "pitch") {
    step.pitch = clamp(step.pitch + pick(random, [-2, -1, 1, 2]), PITCH_MIN, PITCH_MAX);
  } else if (move === "move") {
    const target = (index + pick(random, [-1, 1]) + pattern.len) % pattern.len;
    if (!stepAt(pattern, target).on) {
      pattern.steps[target] = { ...step };
      step.on = false;
    } else {
      step.vel = step.vel === 2 ? 1 : 2;
    }
  } else if (move === "add") {
    const free = Array.from({ length: pattern.len }, (_, at) => at).filter((at) => !stepAt(pattern, at).on);
    if (free.length > 0) put(pattern, pick(random, free), { pitch: step.pitch, vel: 0 });
  } else if (move === "drop" && hits.length > 2) {
    step.on = false;
  } else {
    const feel = pick(random, ["vel", "chance", "ratchet"] as const);
    if (feel === "vel") step.vel = pick(random, [0, 1, 2].filter((value) => value !== step.vel));
    else if (feel === "chance") step.chance = step.chance === 0 ? 2 : 0;
    else step.ratchet = step.ratchet === 1 ? 2 : 1;
  }
}

/** The ring in words, for screen readers and tests: "4 Schläge auf 1, 5, 9, 13". */
export function describe(pattern: Pattern): string {
  const hits = activeSteps(pattern);
  if (hits.length === 0) return `leer, ${pattern.len} Schritte`;
  return `${hits.length} ${hits.length === 1 ? "Schlag" : "Schläge"} auf ${hits.map((index) => index + 1).join(", ")} von ${pattern.len}`;
}
