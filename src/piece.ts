import { BAR, BUILD_BARS, BUILD_BIG, BUILD_GAPS, BUILD_MEDIUM, BUILD_NONE, BUILD_SIZES, BUILD_SMALL, clamp, MARK_ALL, MARK_NAMES, MAX_BARS, MIN_BARS, SCENE_COUNT, SWAY_PARTS, TENSION_MAX, TRACK_COUNT, FIRST_ORDER, type Build, type BuildSize, type Ends, type Piece, type StyleId, type Sway, wrap } from "./model";
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
 * - A bar much higher than the one before is a drop: the Kreisel builds up
 *   to it and lands with a crash. Before a steep fall the last beat is
 *   thrown into the echo.
 *
 * And what makes a piece a techno track:
 *
 * - A bar can be marked "ohne Kick": the kick and its Nachbeben stay out
 *   there, and everything else plays by the tension. That is a break, which
 *   the tension alone cannot give, because the kick is the first to come in.
 *   The bar in which the kick comes back is a drop like a steep rise, and
 *   the bar in which it leaves a fall.
 * - What leads up to a drop is a build-up, a kit of parts (see `Build`): how
 *   many bars it runs, a riser, a roll on the snare's ring, the lows going, a
 *   cloud of hall, the level sinking, the kick or the hi-hat left out for the
 *   last bar, a gap of nothing right before the drop, and a drop that comes
 *   late. A piece has one build-up for all of its drops, and a drop can have
 *   one of its own. The small one (a bar of rising noise) is what a piece has
 *   unless it says otherwise.
 * - "Abwechslung": every eighth bar ends with a kick more, every sixteenth
 *   with two strokes of the tuned drum as well.
 *
 * And at the ends of the phrases, each only if the piece says so (`Ends`):
 * the last kick of a phrase is left out, a crash falls on the one every 16
 * or 32 bars, a cymbal played backwards swells into the next phrase.
 *
 * And once, where it is laid (`Piece.marks`): a bar can carry one or more of
 * the five live effects, which then play there by themselves.
 *
 * And what the tension moves beyond that, each only if the piece says so
 * (`Sway`, "Was die Spannung bewegt"):
 *
 * - The hi-hat rings longer the higher the tension; bass, chords and melody
 *   get brighter; the kick is shorter and thinner where little is going on;
 *   the quiet hits fall away there; every ring is driven a little harder
 *   towards the top; and there is more hall where there is less tension. So a line that climbs by a quarter over sixty-four bars opens
 *   the sound very slowly, and the stretch above the last ring's entry, where
 *   the line used to move nothing, means something.
 *
 * And who plays where, whatever the tension (the roster, "Einsätze"):
 *
 * - A ring can be laid in for a bar, and then plays there in full although
 *   the tension has not reached it; or laid out, and then rests there
 *   although it has. Everywhere else the tension decides, as it always did.
 *   So the hi-hat can leave while the acid line comes, which one order of
 *   coming in cannot give.
 * - The kick laid out is a bar "ohne Kick": the break is the roster's oldest
 *   part and stays where it was kept.
 */

/** The rings these rules name. */
const KICK = 0;
const SNARE = 1;
const HAT = 2;
const DRUM = 3;

/** The ring the roll is played on. */
export const ROLL_RING = SNARE;
/** How many bars belong together: a phrase. The piece's ring is ticked in them, and "ohne Kick" is laid on them. */
export const PHRASE = 8;

/** The tension at which the ring in place `place` of the order comes in (0..1). */
export const entry = (place: number): number => 0.04 + place * 0.13;

/** How steep a step between two bars has to be for a drop or a fall (a share of the full height). */
export const STEEP = 0.28;

/**
 * What the tension moves in one bar, as amounts the sound can take as they are: how far a sound is pushed along its
 * brightness or its length is a share of the way to the end of the pad (0..1, see weather's `shaded`).
 */
export interface BarSway {
  /** How far the hi-hat's length is pushed up. */
  hat: number;
  /** How far the brightness of bass, chords and melody is pushed up (an acid machine's bite too). */
  bright: number;
  /** How far the kick's length is pulled down; its level in the mix goes down by half of that (and the Nachbeben's with it). */
  kick: number;
  /** The quiet hits fall away. */
  thin: boolean;
  /** Zerre on top for every ring, 0..1. */
  drive: number;
  /** Hall on top for everything but kick and bass, 0..1. */
  room: number;
}

/** How far each part of a `Sway` reaches, gently and clearly. Set by measurement (see e2e/sway.spec.ts), not by ear. */
const SWAY_REACH = {
  hat: [0, 0.4, 0.8],
  bright: [0, 0.35, 0.7],
  kick: [0, 0.35, 0.7],
  // Below this tension the quiet hits fall away.
  dense: [0, 0.45, 0.7],
  drive: [0, 0.2, 0.45],
  room: [0, 0.2, 0.4],
} as const;

/** What a piece's `Sway` asks for at a tension (0..1). */
export function swayAt(sway: Readonly<Sway>, tension: number): BarSway {
  const reach = (part: keyof Sway): number => SWAY_REACH[part][clamp(Math.round(sway[part]), 0, 2)] ?? 0;
  const share = clamp(tension, 0, 1);
  return {
    hat: reach("hat") * share,
    bright: reach("bright") * share,
    kick: reach("kick") * (1 - share),
    thin: share < reach("dense"),
    // Only the upper half of the line drives harder.
    drive: reach("drive") * clamp((share - 0.5) * 2, 0, 1),
    room: reach("room") * (1 - share),
  };
}

/** Where a bar stands in a build-up. */
export interface BuildPlace {
  /** The bar the drop lands in. */
  drop: number;
  /** Which bar of the build-up this is, counted as if it ran its full length: its last bar is `kit.bars - 1`. */
  at: number;
  kit: Build;
}

export interface BarPlan {
  /** Per ring: 0 silent, otherwise how firmly it is in (up to 1). */
  gates: number[];
  /** Hz the master lowpass sits at in this bar, and where it is heading by the bar's end. */
  cutoff: number;
  cutoffEnd: number;
  /** The next bar is a drop. */
  rise: boolean;
  /** The next bar is much lower: throw the last beat into the echo. */
  fall: boolean;
  scene: number;
  /** The build-up this bar is part of: the bar its drop lands in, which of the build-up's bars this is (0 the first), and its kit. */
  build: BuildPlace | null;
  /** This bar is a drop: the build-up that led here. */
  drop: Build | null;
  /** This bar plays the build-up's roll (see `rollHits`). */
  roll: boolean;
  /** What the tension moves in this bar beyond who plays; `null` where the piece has none of it. */
  sway: BarSway | null;
  /** The phrase ends with this bar and its last kick is left out. */
  lastKick: boolean;
  /** A crash falls on the one of this bar (a drop that lands with its own crash has none more). */
  crash: boolean;
  /** A cymbal played backwards swells through the second half of this bar into the next phrase. */
  swell: boolean;
  /** The effects laid on this bar, a bit each (see MARK). */
  marks: number;
  /** The small change this bar ends with (see `varyHits`): 0 none, 1 a kick more, 2 the tuned drum as well. */
  vary: number;
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

/** Whether the kick stays out in a bar ("ohne Kick"). */
export const kickOut = (piece: Piece, bar: number): boolean => piece.noKick?.[wrap(bar, barCount(piece))] === true;

/** What the roster says of a ring in a bar. */
export const ROSTER = { tension: 0, plays: 1, rests: 2 } as const;
export type RosterState = (typeof ROSTER)[keyof typeof ROSTER];

/** Whether the tension alone lets a ring play in a bar. */
export const reached = (piece: Piece, ring: number, bar: number): boolean => share(piece, bar) >= entry(Math.max(0, piece.order.indexOf(ring)));

/** What the roster says of ring `ring` in a bar. For the kick, a bar "ohne Kick" is a rest. */
export function rosterOf(piece: Piece, ring: number, bar: number): RosterState {
  const at = wrap(bar, barCount(piece));
  if (ring === KICK && piece.noKick?.[at] === true) return ROSTER.rests;
  const state = piece.roster?.[ring]?.[at];
  return state === ROSTER.plays || (state === ROSTER.rests && ring !== KICK) ? state : ROSTER.tension;
}

/** Whether a ring plays in a bar: because it is laid in, or because the tension has reached it and it is not laid out. */
export function playsThere(piece: Piece, ring: number, bar: number): boolean {
  const state = rosterOf(piece, ring, bar);
  return state === ROSTER.plays || (state === ROSTER.tension && reached(piece, ring, bar));
}

/**
 * What a click on a ring's bar turns it to: the plainest state that changes whether the ring plays there. A ring
 * that plays by the tension is laid out, one the tension has not reached is laid in, and whatever was laid against
 * the tension is given back to it.
 */
export function flipped(piece: Piece, ring: number, bar: number): RosterState {
  const byTension = reached(piece, ring, bar);
  if (playsThere(piece, ring, bar)) return byTension ? ROSTER.rests : ROSTER.tension;
  return byTension ? ROSTER.tension : ROSTER.plays;
}

/** Whether the kick can play in a bar (a bar "ohne Kick" aside): the tension has reached it, or it is laid in. */
const kickIn = (piece: Piece, bar: number): boolean => rosterOf(piece, KICK, bar) === ROSTER.plays || reached(piece, KICK, bar);

/** Whether the bar after `bar` is a drop: much higher, or the bar in which the kick comes back from a break. */
function lands(piece: Piece, bar: number): boolean {
  const now = share(piece, bar);
  const next = share(piece, bar + 1);
  return (next - now >= STEEP && next >= 0.45) || (kickOut(piece, bar) && !kickOut(piece, bar + 1) && kickIn(piece, bar + 1));
}

/** Whether the bar after `bar` is a fall: much lower, or the bar in which the kick leaves for a break. */
function falls(piece: Piece, bar: number): boolean {
  return share(piece, bar) - share(piece, bar + 1) >= STEEP || (!kickOut(piece, bar) && kickIn(piece, bar) && kickOut(piece, bar + 1));
}

/** The effects laid on bar `bar`, a bit each (see MARK); 0 for none. */
export const marksAt = (piece: Piece, bar: number): number => piece.marks?.find((mark) => mark.bar === bar)?.fx ?? 0;

/** The names of the effects in `fx`, in the order of their bits. */
export const markNames = (fx: number): string[] => MARK_NAMES.filter((_, bit) => (fx & (1 << bit)) !== 0);

/** Whether a drop lands in bar `bar`. */
export const isDrop = (piece: Piece, bar: number): boolean => lands(piece, bar - 1);

/** The bars in which a drop lands, from the piece's first bar on. */
export function dropsOf(piece: Piece): number[] {
  const drops: number[] = [];
  for (let bar = 0; bar < barCount(piece); bar += 1) if (isDrop(piece, bar)) drops.push(bar);
  return drops;
}

/** Whether two build-ups are the same in every part. */
export function sameBuild(one: Readonly<Build>, other: Readonly<Build>): boolean {
  return one.bars === other.bars && one.riser === other.riser && one.roll === other.roll && one.lows === other.lows && one.wash === other.wash
    && one.dip === other.dip && one.kick === other.kick && one.hat === other.hat && one.gap === other.gap && one.late === other.late;
}

/** The build-up of all drops that have none of their own. */
export const buildOfAll = (piece: Piece): Readonly<Build> => piece.build ?? BUILD_SMALL;

/** The build-up a drop has of its own, if it has one. */
export const ownBuild = (piece: Piece, drop: number): Build | null => piece.drops?.find((entry) => entry.bar === wrap(drop, barCount(piece)))?.build ?? null;

/** The build-up before the drop that lands in bar `drop`: its own, or the one all drops have. */
export const buildFor = (piece: Piece, drop: number): Readonly<Build> => ownBuild(piece, drop) ?? buildOfAll(piece);

/** The ready-made size a build-up is, or `null` for one put together by hand. */
export function sizeOf(build: Readonly<Build>): BuildSize | null {
  return (Object.keys(BUILD_SIZES) as BuildSize[]).find((size) => sameBuild(BUILD_SIZES[size], build)) ?? null;
}

/** The longest a build-up can be, in bars. */
const LONGEST = BUILD_BARS[BUILD_BARS.length - 1] ?? 8;

/**
 * The build-up a bar is part of. Only the next drop counts: a build-up does not reach back over a drop before its
 * own, so right after a drop a long one begins in its middle.
 */
export function buildAt(piece: Piece, bar: number): BuildPlace | null {
  const count = barCount(piece);
  for (let ahead = 1; ahead <= Math.min(LONGEST, count); ahead += 1) {
    if (!lands(piece, bar + ahead - 1)) continue;
    const drop = wrap(bar + ahead, count);
    const kit = buildFor(piece, drop);
    return ahead <= kit.bars ? { drop, at: kit.bars - ahead, kit } : null;
  }
  return null;
}

/** What bar `bar` of the piece asks for. The piece is a ring: after the last bar comes the first. */
export function planBar(piece: Piece, bar: number): BarPlan {
  const now = share(piece, bar);
  const next = share(piece, bar + 1);
  const gates = Array.from({ length: TRACK_COUNT }, () => 0);
  piece.order.forEach((ring, place) => {
    const above = now - entry(place);
    if (above >= 0) gates[ring] = clamp(0.15 + above / 0.25, 0.15, 1);
  });
  // The roster has the last word on who plays: a ring laid in plays in full, a ring laid out is silent.
  if (piece.roster) {
    for (let ring = 0; ring < TRACK_COUNT; ring += 1) {
      const state = rosterOf(piece, ring, bar);
      if (state === ROSTER.plays) gates[ring] = 1;
      else if (state === ROSTER.rests) gates[ring] = 0;
    }
  }
  const cutoff = cutoffFor(now);
  const count = barCount(piece);
  const at = wrap(bar, count);
  const rise = lands(piece, bar);
  const build = buildAt(piece, bar);
  // The last bar of a build-up can leave the kick or the hi-hat out.
  const last = build !== null && build.at === build.kit.bars - 1;
  if (kickOut(piece, bar) || (last && build.kit.kick)) gates[KICK] = 0;
  if (last && build.kit.hat) gates[HAT] = 0;
  return {
    gates,
    cutoff,
    cutoffEnd: Math.max(cutoff, cutoffFor(next)),
    rise,
    fall: falls(piece, bar),
    scene: piece.scenes[at] ?? 0,
    build,
    drop: isDrop(piece, bar) ? buildFor(piece, at) : null,
    // The roll is the snare's ring playing: where that ring is laid out, there is none.
    roll: build !== null && build.kit.roll && rosterOf(piece, ROLL_RING, bar) !== ROSTER.rests,
    // The bar right before a drop has enough going on.
    vary: piece.vary && !rise && at % PHRASE === PHRASE - 1 ? (at % (PHRASE * 2) === PHRASE * 2 - 1 ? 2 : 1) : 0,
    sway: piece.sway ? swayAt(piece.sway, now) : null,
    lastKick: piece.ends?.kick === true && at % PHRASE === PHRASE - 1,
    crash: (piece.ends?.crash ?? 0) > 0 && at % (piece.ends?.crash ?? 1) === 0 && !(isDrop(piece, bar) && buildFor(piece, at).bars > 0),
    // Where a build-up's riser already swells into the bar that follows, there is no cymbal as well.
    swell: piece.ends?.swell === true && at % PHRASE === PHRASE - 1 && !(build !== null && build.kit.riser > 0),
    marks: marksAt(piece, at),
  };
}

/** How many steps of a build-up's last bar are its gap. */
export const gapSteps = (build: Readonly<Build>): number => Math.min(BAR, Math.max(0, build.gap) * (BAR / 4));

/**
 * The strikes of the roll in bar `at` of a build-up of `of` bars, each with the step it falls on (a half step for a
 * thirty-second) and how loud it is. The roll gets denser and louder all the way, and stops where the gap begins
 * (`gap` beats before the drop).
 *
 * A short one (one or two bars) doubles from half bar to half bar: quarters, eighths, eighths, sixteenths, and in
 * a single bar only the second half of that. A long one (four or eight bars) plays quarters through its first half,
 * eighths through the next quarter, then sixteenths, and thirty-seconds right at the end.
 */
export function rollHits(at: number, of: number, gap = 0): { step: number; level: number }[] {
  if (!Number.isInteger(at) || at < 0 || at >= of) return [];
  // The steps that sound: everything up to the gap.
  const sounding = of * BAR - Math.min(BAR, Math.max(0, gap) * (BAR / 4));
  const from = at * BAR;
  const hits: { step: number; level: number }[] = [];
  if (sounding <= 0) return hits;
  const level = (place: number): number => Math.min(1.2, 0.5 + (0.7 * place) / Math.max(1, of * BAR - 1));
  if (of <= 2) {
    // How far apart the strikes are in each half of the bar.
    const [first, second] = of === 2 && at === 0 ? [4, 2] : [2, 1];
    for (let step = 0; step < BAR && from + step < sounding; step += step < BAR / 2 ? first : second) hits.push({ step, level: level(from + step) });
    return hits;
  }
  for (let half = 0; half < BAR * 2; half += 1) {
    const place = from + half / 2;
    if (place >= sounding) break;
    const along = place / sounding;
    const apart = along < 1 / 2 ? 4 : along < 3 / 4 ? 2 : along < 15 / 16 ? 1 : 0.5;
    if (place % apart === 0) hits.push({ step: half / 2, level: level(place) });
  }
  return hits;
}

/**
 * What a bar's small change adds: a quiet kick more between its last two
 * beats' ends, and in every other phrase two strokes of the tuned drum around it.
 */
export function varyHits(kind: number): { ring: number; step: number; vel: number; pitch: number }[] {
  if (kind !== 1 && kind !== 2) return [];
  const kick = { ring: KICK, step: 14, vel: 0, pitch: 0 };
  return kind === 1 ? [kick] : [kick, { ring: DRUM, step: 13, vel: 1, pitch: 0 }, { ring: DRUM, step: 15, vel: 0, pitch: -3 }];
}

/** A ring that has only just come in leaves its quiet steps out. */
export const dropsQuiet = (gate: number): boolean => gate < 0.45;
/** …and plays a little under its level. */
export const gateLevel = (gate: number): number => 0.72 + 0.28 * gate;

// ---- shaping the line ------------------------------------------------------------

/** Whether an entry of the roster says something of ring `ring`. The kick has no rests there: those are its bars "ohne Kick". */
const laid = (ring: number, state: unknown): state is 1 | 2 => state === ROSTER.plays || (state === ROSTER.rests && ring !== KICK);

/**
 * Keeps a piece plain: the list of bars "ohne Kick" is as long as the piece
 * and is there only while a bar is marked; the roster has a list as long as
 * the piece for every ring that has something laid, and is there only while
 * one has; the build-up of all drops is there only while it is not the small
 * one, and a drop's own only where a drop lands and while it differs from
 * that of all; the Abwechslung is there only while it is on. A piece with
 * none of it is exactly what a piece always was, in memory and in a link.
 */
export function tidyPiece(piece: Piece): void {
  const count = barCount(piece);
  if (piece.noKick?.some(Boolean)) piece.noKick = Array.from({ length: count }, (_, bar) => piece.noKick?.[bar] === true);
  else delete piece.noKick;
  const roster = Array.from({ length: TRACK_COUNT }, (_, ring) => {
    const list = piece.roster?.[ring];
    // A bar "ohne Kick" is the kick's rest: nothing can be laid under it.
    const state = (bar: number): number => (ring === KICK && piece.noKick?.[bar] === true ? 0 : laid(ring, list?.[bar]) ? (list?.[bar] as number) : 0);
    const bars = Array.from({ length: count }, (_, bar) => state(bar));
    return bars.some((entry) => entry !== 0) ? bars : [];
  });
  if (roster.some((list) => list.length > 0)) piece.roster = roster;
  else delete piece.roster;
  const all = soundBuild(piece.build);
  if (all && !sameBuild(all, BUILD_SMALL)) piece.build = all;
  else delete piece.build;
  const own: { bar: number; build: Build }[] = [];
  for (const entry of piece.drops ?? []) {
    const build = soundBuild(entry?.build);
    const bar = entry?.bar;
    if (!build || !Number.isInteger(bar) || bar < 0 || bar >= count || own.some((other) => other.bar === bar)) continue;
    if (isDrop(piece, bar) && !sameBuild(build, buildOfAll(piece))) own.push({ bar, build });
  }
  if (own.length > 0) piece.drops = own.sort((one, other) => one.bar - other.bar);
  else delete piece.drops;
  if (piece.vary !== true) delete piece.vary;
  const sway = soundSway(piece.sway);
  if (sway) piece.sway = sway;
  else delete piece.sway;
  const ends = soundEnds(piece.ends);
  if (ends) piece.ends = ends;
  else delete piece.ends;
  const marks = soundMarks(piece.marks, count);
  if (marks.length > 0) piece.marks = marks;
  else delete piece.marks;
}

/** `Ends` as far as a claim plainly says them; nothing for a claim that says nothing. */
export function soundEnds(value: unknown): Ends | null {
  if (typeof value !== "object" || value === null) return null;
  const claim = value as Record<string, unknown>;
  const ends: Ends = { kick: claim.kick === true, crash: claim.crash === 16 || claim.crash === 32 ? claim.crash : 0, swell: claim.swell === true };
  return ends.kick || ends.crash > 0 || ends.swell ? ends : null;
}

/** How many effect marks a piece can carry. */
export const MAX_MARKS = 64;

/** Effect marks as far as a claim plainly says them: bars of the piece, each once, with effects that exist; sorted by bar. */
export function soundMarks(value: unknown, count: number): { bar: number; fx: number }[] {
  if (!Array.isArray(value)) return [];
  const marks: { bar: number; fx: number }[] = [];
  for (const entry of value as unknown[]) {
    const claim = (typeof entry === "object" && entry !== null ? entry : {}) as { bar?: unknown; fx?: unknown };
    const { bar, fx } = claim;
    if (typeof bar !== "number" || typeof fx !== "number" || !Number.isInteger(bar) || !Number.isInteger(fx)) continue;
    if (bar < 0 || bar >= count || (fx & MARK_ALL) === 0 || fx !== (fx & MARK_ALL) || marks.some((mark) => mark.bar === bar)) continue;
    if (marks.length < MAX_MARKS) marks.push({ bar, fx });
  }
  return marks.sort((one, other) => one.bar - other.bar);
}

/** Switches one of the things at the ends of the phrases: the last kick left out, the crash (0, 16 or 32), the backwards cymbal. */
export function setEnds(piece: Piece, change: Partial<Ends>): void {
  piece.ends = { kick: false, crash: 0, swell: false, ...piece.ends, ...change };
  tidyPiece(piece);
}

/** How many things happen by themselves at the ends of the phrases, the fills among them. */
export const endsCount = (piece: Piece): number => (piece.vary ? 1 : 0) + (piece.ends?.kick ? 1 : 0) + ((piece.ends?.crash ?? 0) > 0 ? 1 : 0) + (piece.ends?.swell ? 1 : 0);

/** Lays effect `fx` (one bit of MARK) on bar `bar`, or takes it away again. */
export function toggleMark(piece: Piece, bar: number, fx: number): void {
  const now = marksAt(piece, bar);
  piece.marks = [...(piece.marks ?? []).filter((mark) => mark.bar !== bar), { bar, fx: now ^ fx }];
  tidyPiece(piece);
}

/** Takes every effect mark away from bar `bar`, or with `null` from the whole piece. */
export function clearMarks(piece: Piece, bar: number | null): void {
  if (bar === null) delete piece.marks;
  else if (piece.marks) piece.marks = piece.marks.filter((mark) => mark.bar !== bar);
  tidyPiece(piece);
}

/** A `Sway` as far as a claim plainly says one: each part off, gently or clearly. Nothing for one that moves nothing. */
export function soundSway(value: unknown): Sway | null {
  if (typeof value !== "object" || value === null) return null;
  const claim = value as Record<string, unknown>;
  const sway = Object.fromEntries(SWAY_PARTS.map((part) => [part, claim[part] === 1 || claim[part] === 2 ? claim[part] : 0])) as unknown as Sway;
  return SWAY_PARTS.some((part) => sway[part] > 0) ? sway : null;
}

/** Sets how far the tension moves one thing: 0 not at all, 1 gently, 2 clearly. */
export function setSway(piece: Piece, part: keyof Sway, depth: number): void {
  piece.sway = { hat: 0, bright: 0, kick: 0, dense: 0, drive: 0, room: 0, ...piece.sway, [part]: depth };
  tidyPiece(piece);
}

/** How many things the tension moves beyond who plays. */
export const swayCount = (piece: Piece): number => SWAY_PARTS.filter((part) => (piece.sway?.[part] ?? 0) > 0).length;

/** A build-up as far as a claim plainly says one: its length is one a build-up can have, and each part is on only if it says so. */
export function soundBuild(value: unknown): Build | null {
  if (typeof value !== "object" || value === null) return null;
  const claim = value as Record<string, unknown>;
  const bars = BUILD_BARS.find((length) => length === claim.bars);
  if (bars === undefined) return null;
  // No build-up is no build-up: it has no parts.
  if (bars === 0) return { ...BUILD_NONE };
  return {
    bars,
    riser: claim.riser === 1 || claim.riser === 2 ? claim.riser : 0,
    roll: claim.roll === true,
    lows: claim.lows === true,
    wash: claim.wash === true,
    dip: claim.dip === true,
    kick: claim.kick === true,
    hat: claim.hat === true,
    gap: BUILD_GAPS.find((beats) => beats === claim.gap) ?? 0,
    late: claim.late === true,
  };
}

/** The phrase a bar belongs to: its first bar and the one after its last. */
export function phraseOf(piece: Piece, bar: number): { from: number; to: number } {
  const from = Math.floor(bar / PHRASE) * PHRASE;
  return { from, to: Math.min(barCount(piece), from + PHRASE) };
}

/** Marks the bars from `from` up to `to` as "ohne Kick", or lets the kick play there again. */
export function setKick(piece: Piece, from: number, to: number, plays: boolean): void {
  const count = barCount(piece);
  const marks = Array.from({ length: count }, (_, bar) => piece.noKick?.[bar] === true);
  for (let bar = Math.max(0, from); bar < Math.min(count, to); bar += 1) marks[bar] = !plays;
  piece.noKick = marks;
  tidyPiece(piece);
}

/**
 * Lays ring `ring` in (plays) or out (rests) for the bars from `from` up to `to`, or gives it back to the tension
 * there. The kick laid out is a break: those bars are "ohne Kick".
 */
export function setRoster(piece: Piece, ring: number, from: number, to: number, state: RosterState): void {
  const count = barCount(piece);
  if (!Number.isInteger(ring) || ring < 0 || ring >= TRACK_COUNT) return;
  const roster = Array.from({ length: TRACK_COUNT }, (_, at) => Array.from({ length: count }, (_, bar) => piece.roster?.[at]?.[bar] ?? 0));
  const list = roster[ring] as number[];
  for (let bar = Math.max(0, from); bar < Math.min(count, to); bar += 1) list[bar] = ring === KICK && state === ROSTER.rests ? 0 : state;
  piece.roster = roster;
  if (ring === KICK) setKick(piece, from, to, state !== ROSTER.rests);
  else tidyPiece(piece);
}

/** Lays every ring in for the bars from `from` up to `to`: all of them play there, whatever the tension. */
export function fillRoster(piece: Piece, from: number, to: number): void {
  for (let ring = 0; ring < TRACK_COUNT; ring += 1) setRoster(piece, ring, from, to, ROSTER.plays);
}

/** Gives every ring back to the tension for the bars from `from` up to `to`; a break there goes too. */
export function clearRoster(piece: Piece, from: number, to: number): void {
  for (let ring = 0; ring < TRACK_COUNT; ring += 1) setRoster(piece, ring, from, to, ROSTER.tension);
}

/**
 * Gives the drop that lands in bar `drop` this build-up as its own, or, with `null` for the drop, all drops that have
 * none of their own. A drop whose own is the same as that of all has none.
 */
export function setBuild(piece: Piece, drop: number | null, build: Readonly<Build>): void {
  if (drop === null) piece.build = { ...build };
  else piece.drops = [...(piece.drops ?? []).filter((entry) => entry.bar !== drop), { bar: drop, build: { ...build } }];
  tidyPiece(piece);
}

/** "Für alle Drops übernehmen": every drop gets the build-up of the one in bar `drop`, and none keeps its own. */
export function shareBuild(piece: Piece, drop: number): void {
  piece.build = { ...buildFor(piece, drop) };
  delete piece.drops;
  tidyPiece(piece);
}

/** "Wieder wie alle Drops": the drop in bar `drop` gives up its own build-up; with `null`, every drop does. */
export function clearBuild(piece: Piece, drop: number | null): void {
  if (drop === null) delete piece.drops;
  else if (piece.drops) piece.drops = piece.drops.filter((entry) => entry.bar !== drop);
  tidyPiece(piece);
}

/** The name of a build-up's size, as the page says it: "eigen" for one put together by hand. */
export function sizeName(build: Readonly<Build>): string {
  const size = sizeOf(build);
  return size === "gross" ? "groß" : size ?? "eigen";
}

/** How many bars before its drop a build-up begins on the piece's ring: its length, or less where another drop lands before. */
export function buildReach(piece: Piece, drop: number): number {
  const bars = buildFor(piece, drop).bars;
  for (let back = 1; back < bars; back += 1) if (isDrop(piece, drop - back)) return back;
  return Math.min(bars, barCount(piece));
}

/** A build-up in words: its size, how long it runs and what it is made of. */
export function describeBuild(build: Readonly<Build>): string {
  if (build.bars === 0) return "kein Build-up";
  const parts = [
    ...(build.riser === 2 ? ["Riser mit Ton"] : build.riser === 1 ? ["Riser"] : []),
    ...(build.roll ? ["Roll"] : []),
    ...(build.lows ? ["Tiefen raus"] : []),
    ...(build.wash ? ["Hall-Wolke"] : []),
    ...(build.dip ? ["leiser"] : []),
    ...(build.kick ? ["letzter Takt ohne Kick"] : []),
    ...(build.hat ? ["letzter Takt ohne Hi-Hat"] : []),
    ...(build.gap > 0 ? [`Lücke ${build.gap === 1 ? "ein Schlag" : build.gap === 2 ? "ein halber Takt" : "ein Takt"}`] : []),
    ...(build.late ? ["später Drop"] : []),
  ];
  return `Build-up ${sizeName(build)}, ${build.bars === 1 ? "1 Takt" : `${build.bars} Takte`}: ${parts.length > 0 ? parts.join(", ") : "nur der Crash"}`;
}

export function setVary(piece: Piece, on: boolean): void {
  piece.vary = on;
  tidyPiece(piece);
}

/** A new length: the line and the scenes are stretched, not cut, so the piece keeps its shape. */
export function resizePiece(piece: Piece, bars: number): void {
  const count = clamp(Math.round(bars), MIN_BARS, MAX_BARS);
  const old = barCount(piece);
  if (count === old) return;
  const at = (index: number): number => Math.min(old - 1, Math.floor((index * old) / count));
  const tension = Array.from({ length: count }, (_, index) => piece.tension[at(index)] ?? 0);
  const scenes = Array.from({ length: count }, (_, index) => piece.scenes[at(index)] ?? 0);
  const noKick = Array.from({ length: count }, (_, index) => piece.noKick?.[at(index)] === true);
  const roster = piece.roster?.map((list) => (list.length === 0 ? [] : Array.from({ length: count }, (_, index) => list[at(index)] ?? 0)));
  // A drop moves with the bar it lands in: to the first bar of the new line that is taken from it.
  const drops = piece.drops?.map((entry) => ({ ...entry, bar: Math.ceil((entry.bar * count) / old) }));
  // An effect mark goes to the first bar that is taken from its own; in a shorter piece the first of two that meet stays.
  const marks = piece.marks?.map((mark) => ({ ...mark, bar: Math.ceil((mark.bar * count) / old) }));
  piece.tension = tension;
  piece.scenes = scenes;
  piece.noKick = noKick;
  if (roster) piece.roster = roster;
  if (drops) piece.drops = drops;
  if (marks) piece.marks = marks;
  tidyPiece(piece);
}

/** Turns the piece: every bar moves `by` bars later. */
export function rotatePiece(piece: Piece, by: number): void {
  const count = barCount(piece);
  const shift = wrap(by, count);
  if (shift === 0) return;
  const turn = <T>(list: T[]): T[] => list.map((_, index) => list[(index - shift + count) % count] as T);
  piece.tension = turn(piece.tension);
  piece.scenes = turn(piece.scenes);
  if (piece.noKick) piece.noKick = turn(Array.from({ length: count }, (_, bar) => piece.noKick?.[bar] === true));
  if (piece.roster) piece.roster = piece.roster.map((list) => (list.length === 0 ? [] : turn(Array.from({ length: count }, (_, bar) => list[bar] ?? 0))));
  if (piece.drops) piece.drops = piece.drops.map((entry) => ({ ...entry, bar: (entry.bar + shift) % count })).sort((one, other) => one.bar - other.bar);
  if (piece.marks) piece.marks = piece.marks.map((mark) => ({ ...mark, bar: (mark.bar + shift) % count })).sort((one, other) => one.bar - other.bar);
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
 * a little at its half. A break is without the kick: the drums around it and
 * the bass play on, a little duller, and through its second half the tension
 * climbs until the chords are there; then the kick comes back, which is a
 * landing. The outro takes the piece apart, ring by ring.
 */
function technoLine(count: number, random: Random): { tension: number[]; noKick: boolean[] } {
  const between = (low: number, high: number): number => low + random() * (high - low);
  const tension: number[] = [];
  const noKick: boolean[] = [];
  let fulls = 0;
  for (const { role, bars } of technoSections(count, random)) {
    let from: number;
    let to: number;
    if (role === "intro") [from, to] = [between(0.06, 0.12), between(0.44, 0.52)];
    else if (role === "outro") [from, to] = [between(0.7, 0.8), between(0.06, 0.12)];
    else if (role === "break") [from, to] = [between(0.57, 0.62), between(0.7, 0.76)];
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
      noKick.push(role === "break");
    }
  }
  return { tension, noKick };
}

/**
 * Lets a techno form grow towards its end: its last drop gets the biggest build-up the piece has room for (the big
 * one where the sections are sixteen bars long, the middle one where they are eight), and in a long piece the drops
 * between the first and the last get the middle one. The first stays small. Only while all drops have the small
 * build-up: whoever chose another one for all of them has said what they want.
 */
function sizeDrops(piece: Piece): void {
  if (piece.build) return;
  // A drop in the first bar would be the turn of the ring, from the outro into the intro: a techno form has none.
  const drops = dropsOf(piece).filter((bar) => bar > 0);
  if (drops.length < 2) return;
  const long = barCount(piece) >= 64;
  const last = drops[drops.length - 1] as number;
  piece.drops = [
    ...(long ? drops.slice(1, -1).map((bar) => ({ bar, build: { ...BUILD_MEDIUM } })) : []),
    { bar: last, build: { ...(long ? BUILD_BIG : BUILD_MEDIUM) } },
  ];
}

/**
 * A new line for the piece, with the form of a track. In the free style it
 * comes in sections of four or eight bars: it starts low and climbs, perhaps
 * breaks, lands on a peak, stays up or breaks once more, and fades out in its
 * last section. In techno it is a techno form (see `technoSections`), where
 * the piece is long enough for one; its breaks are "ohne Kick". The scenes
 * stay as they are, and so do the build-up of all drops and the Abwechslung;
 * bars that were "ohne Kick", whatever else the roster held, the build-ups
 * that drops had of their own and the effect marks belonged to the old line
 * and go with it. A techno form whose drops all have the small build-up gets bigger ones
 * towards its end (see `sizeDrops`).
 */
export function dicePiece(piece: Piece, random: Random, style: StyleId = "frei"): void {
  const count = barCount(piece);
  delete piece.roster;
  delete piece.drops;
  delete piece.marks;
  if (style === "techno" && count >= TECHNO_FORM_MIN) {
    const line = technoLine(count, random);
    piece.tension = line.tension;
    piece.noKick = line.noKick;
    tidyPiece(piece);
    sizeDrops(piece);
    return;
  }
  delete piece.noKick;
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
  const breaks = piece.noKick?.filter(Boolean).length ?? 0;
  return `${count} Takte, ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Minuten, im Mittel ${mean} % Spannung${breaks > 0 ? `, ${breaks} Takte Break` : ""}`;
}

/** How many drops of a piece can have a build-up of their own. */
export const MAX_OWN_BUILDS = 32;

/** What a piece can have beyond its line, scenes and order, as a link may claim it. */
export interface PieceExtras {
  noKick?: readonly unknown[];
  /** A list a ring, one entry a bar (see `Piece.roster`). */
  roster?: readonly unknown[];
  /** The build-up of all drops (see `Piece.build`), and the drops' own as a list of `{ bar, build }`. */
  build?: unknown;
  drops?: unknown;
  vary?: unknown;
  /** What the tension moves (see `Piece.sway`). */
  sway?: unknown;
  /** What happens at the ends of the phrases (see `Piece.ends`), and the effect marks (see `Piece.marks`). */
  ends?: unknown;
  marks?: unknown;
}

/**
 * Whatever a link claims, a piece is 4 to 256 bars with tensions and scenes in range and every ring once in its order.
 * Its bars "ohne Kick", its roster, its build-ups and its Abwechslung are there only as far as the link plainly says so.
 * A kick that a link lays out is a break.
 */
export function soundPiece(on: boolean, tension: readonly number[], scenes: readonly number[], order: readonly number[], fallbackScene: number, extras: PieceExtras = {}): Piece {
  const count = clamp(tension.length, MIN_BARS, MAX_BARS);
  const rings = order.filter((ring, index) => Number.isInteger(ring) && ring >= 0 && ring < TRACK_COUNT && order.indexOf(ring) === index);
  // A kick that a link lays out is a break.
  const kicks = Array.isArray(extras.roster?.[KICK]) ? (extras.roster[KICK] as unknown[]) : [];
  const piece: Piece = {
    on,
    tension: Array.from({ length: count }, (_, index) => clamp(Math.round(tension[index] ?? 0), 0, TENSION_MAX)),
    scenes: Array.from({ length: count }, (_, index) => {
      const scene = Math.round(scenes[index] ?? fallbackScene);
      return scene >= 0 && scene < SCENE_COUNT ? scene : fallbackScene;
    }),
    order: rings.length === TRACK_COUNT ? rings : [...FIRST_ORDER],
    noKick: Array.from({ length: count }, (_, bar) => extras.noKick?.[bar] === true || kicks[bar] === ROSTER.rests),
    roster: Array.from({ length: TRACK_COUNT }, (_, ring) => {
      const list = extras.roster?.[ring];
      return Array.isArray(list) ? Array.from({ length: count }, (_, bar) => (laid(ring, list[bar]) ? (list[bar] as number) : 0)) : [];
    }),
    vary: extras.vary === true,
  };
  const all = soundBuild(extras.build);
  if (all) piece.build = all;
  const sway = soundSway(extras.sway);
  if (sway) piece.sway = sway;
  const ends = soundEnds(extras.ends);
  if (ends) piece.ends = ends;
  const marks = soundMarks(extras.marks, count);
  if (marks.length > 0) piece.marks = marks;
  if (Array.isArray(extras.drops)) {
    piece.drops = (extras.drops as unknown[]).slice(0, MAX_OWN_BUILDS).flatMap((entry) => {
      const claim = (typeof entry === "object" && entry !== null ? entry : {}) as { bar?: unknown; build?: unknown };
      const build = soundBuild(claim.build);
      return build && typeof claim.bar === "number" ? [{ bar: claim.bar, build }] : [];
    });
  }
  tidyPiece(piece);
  return piece;
}
