import { ACID_SOUND, clamp, stepAt, type Acid, type Pattern } from "./model";

/*
 * The acid machine: one voice in the manner of the little silver bass
 * machine that acid is named after. A saw or a square through a low-pass that
 * rings at its corner; an envelope that opens the filter at every note and
 * lets it fall shut; accents that are louder, shorter and harder and push one
 * another higher when they follow closely; and slides, where a note that is
 * held into the next one glides into it without being struck again.
 *
 * Everything here is plain arithmetic: how long a note sounds, which notes
 * are tied, where the filter stands. src/audio/acid.ts makes it sound.
 */

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;

/** A machine fresh out of the box: a saw that bites and lets go quickly. */
export function firstAcid(): Acid {
  return { bite: 0.6, decay: 0.35, square: false };
}

/** Whatever a link claims, a machine has its two amounts in range and one of its two waves. */
export function cleanAcid(value: Partial<Acid> | null | undefined): Acid {
  const fresh = firstAcid();
  const share = (amount: unknown, fallback: number): number => (typeof amount === "number" && Number.isFinite(amount) ? clamp(amount, 0, 1) : fallback);
  return { bite: share(value?.bite, fresh.bite), decay: share(value?.decay, fresh.decay), square: value?.square === true };
}

/** The two rings a machine can stand on: the bass, and the melody for a second line above it. */
export const takesAcid = (track: number): boolean => track === 4 || track === 6;

// ---- how long a note sounds, and which notes are tied -------------------------------

/** The share of a step the machine plays a plain note for: it lets go a little after the middle, as the machine it is after does. */
export const ACID_GATE = 0.55;
/** A note that still sounds this many seconds before the next one begins is tied to it. */
const TIE_SLACK = 0.012;
/** Seconds a slide takes, whatever the distance. */
export const SLIDE_SECONDS = 0.06;

/**
 * Seconds a note of `len` steps sounds. The acid machine plays a plain note
 * for little more than half a step, so that two notes side by side are two
 * notes; every other sound holds a note for nearly all of its steps.
 */
export function noteSeconds(sound: number, len: number, stepSeconds: number): number {
  return sound === ACID_SOUND ? (len - 1 + ACID_GATE) * stepSeconds : len * stepSeconds * 0.92;
}

/** Whether a note of `len` steps still sounds when a note `distance` steps after it begins: then the two are tied. */
export function tiesInto(sound: number, len: number, distance: number, stepSeconds: number): boolean {
  return noteSeconds(sound, len, stepSeconds) > distance * stepSeconds - TIE_SLACK;
}

/** The next hit after `index` on the ring (the ring is a circle), and how many steps away it is; `null` on a ring with one hit or none. */
export function nextHit(pattern: Pattern, index: number): { index: number; distance: number } | null {
  for (let distance = 1; distance < pattern.len; distance += 1) {
    const at = (index + distance) % pattern.len;
    if (stepAt(pattern, at).on) return { index: at, distance };
  }
  return null;
}

/**
 * Whether the hit at `index` slides into the one after it: it is tied to it,
 * and the two differ in pitch. (Tied notes of one pitch are simply one long
 * note.) `null` where there is no next hit.
 */
export function slidesInto(pattern: Pattern, index: number, sound: number, stepSeconds: number): boolean {
  const here = stepAt(pattern, index);
  const next = nextHit(pattern, index);
  if (!here.on || !next || here.ratchet > 1) return false;
  return tiesInto(sound, here.len, next.distance, stepSeconds) && stepAt(pattern, next.index).pitch !== here.pitch;
}

/** The length a note needs so that the machine ties it to a note `distance` steps on: it has to reach into that note. */
export const lenToTie = (distance: number): number => distance + 1;

// ---- the filter ----------------------------------------------------------------------

/** Hz the filter rests at for the pad's point from left to right. */
export const restHz = (x: number): number => expo(90, 2600, clamp(x, 0, 1));

/** How much the filter rings at its corner for the pad's point from bottom to top, in dB (which is how the browser's low-pass takes it). */
export const resonanceDb = (y: number): number => 26 * clamp(y, 0, 1) ** 0.8;

/** The most the charge of accents can be: about what three in a row leave. */
export const CHARGE_MAX = 2.4;
/** Seconds in which the charge of an accent has leaked away to about a third. */
const CHARGE_SECONDS = 0.4;

/** What is left of the accents' charge `seconds` after it was last counted, with this accent added. */
export function charged(charge: number, seconds: number): number {
  return Math.min(CHARGE_MAX, Math.max(0, charge) * Math.exp(-Math.max(0, seconds) / CHARGE_SECONDS) + 1);
}

export interface Bite {
  /** How many times its resting Hz the filter is opened to at the strike. */
  open: number;
  /** The time constant with which it falls back, in seconds. */
  seconds: number;
  /** How much louder the note is than a plain one. */
  loud: number;
}

/**
 * What the envelope does at a note. A plain note opens the filter by as much
 * as "Biss" says and lets it fall as slowly as "Dauer" says. An accented note
 * is louder, falls back at the shortest time whatever "Dauer" says, and is
 * opened further: the more the filter rings (the pad's height), and the more
 * charge earlier accents have left, the further.
 */
export function biteOf(acid: Acid, accent: boolean, charge: number, y: number): Bite {
  const open = 1 + clamp(acid.bite, 0, 1) * 9;
  if (!accent) return { open, seconds: expo(0.05, 0.6, clamp(acid.decay, 0, 1)), loud: 1 };
  return { open: open * (1.3 + 0.45 * Math.max(0, charge) * (0.3 + 0.7 * clamp(y, 0, 1))), seconds: 0.05, loud: 1.3 };
}

/** Hz below which the machine is thinned out while the ground shakes, so that the Nachbeben has the lows to itself. */
export const THIN_BELOW = 150;
