import { clamp, PITCH_MAX, PITCH_MIN, wrap, type Sample } from "./model";
import { rootNear } from "./music";

/*
 * A ring's sample: a recording the ring plays, the fourth sound a ring can
 * have of its own. It comes from a file, from the microphone, or from the
 * Kreisel itself (what it plays, pressed onto a ring).
 *
 * A recording is played in one of two ways. As a HIT (the page calls it a "One-shot"), every hit of the ring
 * plays all of it: a kick, a shout, a stab; a ring that plays notes plays it
 * higher and lower, the way one sampled chord is played up and down a
 * keyboard. In SLICES it lies around the ring like the groove of a record,
 * cut into as many slices as the ring has steps: a hit plays the slice it
 * lies on. Turning the ring moves every hit onto another slice, and pulling a
 * hit outwards or inwards lets it take a slice further on or back. A hit
 * plays on from its slice until the next hit comes: one hit on the first step
 * plays the whole recording through, and every further hit is a place where
 * the needle is dropped anew. That is how a break is chopped. The record can
 * also be turned under the ring, so that every step finds another slice.
 *
 * Everything here is plain arithmetic and words: which slice, how fast, how
 * it travels in a link. src/audio/sample.ts makes it sound, and
 * src/sample-store.ts keeps the recordings.
 */

export const HIT = 0;
export const SLICES = 1;

export const MODES = [
  { name: "One-shot", hint: "Every hit plays the whole recording; a ring that plays notes plays it higher and lower" },
  { name: "Slices", hint: "The recording lies around the ring, cut into its steps: a hit plays on from the slice it lies on until the next hit comes; pulled out or in, it starts a slice later or earlier" },
] as const;

export const CHOP = 0;
export const SPEED = 1;
export const STRETCH = 2;

export const FITS = [
  { name: "Chop", hint: "The recording at its own speed and pitch: every hit drops the needle on its slice, wherever the recording had got to" },
  { name: "Speed", hint: "The recording sped up or slowed down until every slice fills its step, as a record played at another speed: the pitch goes with it" },
  { name: "Stretch", hint: "The recording made longer or shorter at its own pitch until every slice fills its step, the way the old Akai samplers did it: stretched far, it buzzes, and the buzz is the key's root" },
] as const;

/** A name is at most this long, an id exactly this long. */
export const MAX_NAME = 24;
export const ID_LENGTH = 16;
/** A recording longer than this is cut when it comes in: a ring is a loop of a few bars, not a tape. */
export const MAX_SECONDS = 60;
/** How far a sample can be tuned, in semitones either way. */
export const TUNE_MAX = 24;
/** A recipe (a packed Kreisel) longer than this is not carried: the recording then lives in this browser only. */
export const MAX_RECIPE = 24_000;
/** A Kreisel whose rings play records of Kreisels whose rings play records …: a record is made again from its recipe this deep and no further. */
export const DEEPEST_RECIPE = 3;
/** How many times as long a hit can be stretched. */
export const STRETCH_MAX = 8;
/** How far a record is stretched or squeezed to fit its steps: beyond this there is little left of it. */
const FIT_LEAST = 0.25;
/** A record can be turned on by up to this many steps less one (a ring has at most this many). */
export const TURNS = 32;
/** The shortest part of a recording that can be played, as a share of it. */
const LEAST = 0.001;
/** Where the played part begins and ends is carried in so many parts of the recording. */
const PARTS = 1_000_000;

const share = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : fallback);

/** A recording as it is when it has just come in: all of it, as it is. */
export function firstSample(id: string, name: string, mode: number = HIT): Sample {
  return { id, name, mode, fit: CHOP, from: 0, to: 1, tune: 0, back: false, turn: 0, gain: 1, stretch: 1 };
}

/** A name as a Kreisel carries it: no dots (they part the numbers in a link), nothing a browser would not show, at most `MAX_NAME` characters. */
export function cleanName(name: unknown): string {
  // Everything below a space is a control character: a name has none.
  const plain = Array.from(typeof name === "string" ? name : "", (letter) => ((letter.codePointAt(0) ?? 0) < 32 || letter === "." ? " " : letter)).join("");
  const tidy = plain.replace(/\s+/g, " ").trim().slice(0, MAX_NAME).trim();
  return tidy === "" ? "sample" : tidy;
}

/** Whatever claims to be a sample, put right; nothing at all where it names no recording. */
export function cleanSample(value: unknown): Sample | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const claim = value as Partial<Record<keyof Sample, unknown>>;
  if (typeof claim.id !== "string" || !/^[0-9a-f]{16}$/.test(claim.id)) return undefined;
  // To the precision a link carries: a sample is the same after it travelled, was saved, or was taken back.
  const from = Math.min(Math.round(share(claim.from, 0) * PARTS) / PARTS, 1 - LEAST);
  const to = Math.max(Math.round(share(claim.to, 1) * PARTS) / PARTS, from + LEAST);
  const tune = typeof claim.tune === "number" && Number.isFinite(claim.tune) ? clamp(Math.round(claim.tune * 100) / 100, -TUNE_MAX, TUNE_MAX) : 0;
  const gain = typeof claim.gain === "number" && Number.isFinite(claim.gain) ? clamp(Math.round(claim.gain * 100) / 100, 0, 2) : 1;
  const recipe = typeof claim.recipe === "string" && claim.recipe.length > 0 && claim.recipe.length <= MAX_RECIPE ? claim.recipe : undefined;
  return {
    id: claim.id,
    name: cleanName(claim.name),
    mode: claim.mode === SLICES ? SLICES : HIT,
    fit: claim.fit === SPEED ? SPEED : claim.fit === STRETCH ? STRETCH : CHOP,
    from,
    to,
    tune,
    back: claim.back === true,
    turn: typeof claim.turn === "number" && Number.isFinite(claim.turn) ? wrap(Math.round(claim.turn), TURNS) : 0,
    gain,
    stretch: typeof claim.stretch === "number" && Number.isFinite(claim.stretch) ? clamp(Math.round(claim.stretch * 100) / 100, 1, STRETCH_MAX) : 1,
    ...(recipe === undefined ? {} : { recipe }),
  };
}

/**
 * A sample as a link carries it: its numbers, the name of its recording and its own name, parted by dots. Where it
 * begins and ends in millionths (a thousandth of a minute of sound is 60 ms: too coarse for a loop), its tuning in hundredths of a semitone above −24, its loudness and its stretch in
 * hundredths. (Its recipe, if it has one, is kept beside it, not in here.)
 */
export function packSample(sample: Sample): string {
  return [sample.mode, sample.fit, Math.round(sample.from * PARTS), Math.round(sample.to * PARTS), Math.round((sample.tune + TUNE_MAX) * 100), sample.back ? 1 : 0, Math.round(sample.gain * 100), sample.turn, Math.round(sample.stretch * 100), sample.id, cleanName(sample.name)].join(".");
}

/** A sample from a link, with its recipe from beside it; anything else is no sample. */
export function unpackSample(value: unknown, recipe?: unknown): Sample | undefined {
  if (typeof value !== "string" || value.length > 120) return undefined;
  const parts = value.split(".");
  if (parts.length !== 11) return undefined;
  const numbers = parts.slice(0, 9).map((part) => (/^\d{1,7}$/.test(part) ? Number(part) : Number.NaN));
  if (numbers.some((part) => Number.isNaN(part))) return undefined;
  const [mode = 0, fit = 0, from = 0, to = PARTS, tune = TUNE_MAX * 100, back = 0, gain = 100, turn = 0, stretch = 100] = numbers;
  return cleanSample({ id: parts[9], name: parts[10], mode, fit, from: from / PARTS, to: to / PARTS, tune: tune / 100 - TUNE_MAX, back: back === 1, gain: gain / 100, turn, stretch: stretch / 100, recipe });
}

// ---- slices ----------------------------------------------------------------------------

/**
 * The slice a hit begins with: the one it lies on (with the record turned on by `turn` steps under the ring), or one so
 * many slices further on (its step pulled outwards) or back (pulled inwards). A ring is a circle, and so is the
 * recording on it.
 */
export const sliceOf = (step: number, offset: number, count: number, turn = 0): number => wrap(step + turn + offset, Math.max(1, count));

/** The keys of the home row that play a record by hand: eight places around it. */
export const PLAY_KEYS = 8;

/**
 * How far a hit on `step` has to be pulled out (or in, below zero) to begin with slice `slice`: the nearest way round
 * that a hit can be pulled, and as near as it gets where the slice is out of its reach (a ring of 32 steps has more
 * slices than a hit has places across the ring).
 */
export function sliceOffset(step: number, slice: number, count: number, turn = 0): number {
  const size = Math.max(1, count);
  const on = wrap(slice - turn - step, size);
  const ways = [on, on - size].filter((way) => way >= PITCH_MIN && way <= PITCH_MAX);
  if (ways.length > 0) return ways.reduce((best, way) => (Math.abs(way) < Math.abs(best) ? way : best));
  return on - size < PITCH_MIN && Math.abs(on - size - PITCH_MIN) < Math.abs(on - PITCH_MAX) ? PITCH_MIN : PITCH_MAX;
}

/**
 * Where slice `slice` of `count` lies, as shares 0..1 of the recording as it is played (the part between `from` and
 * `to`; for a sample played backwards, that part turned round, so that the first slice is the recording's last).
 */
export function sliceSpan(sample: Pick<Sample, "from" | "to" | "back">, slice: number, count: number): { from: number; to: number } {
  const [from, to] = playedSpan(sample);
  const width = (to - from) / Math.max(1, count);
  const at = wrap(slice, Math.max(1, count));
  return { from: from + at * width, to: from + (at + 1) * width };
}

/** The part of the recording that is played, as shares of the sound as it runs: of the recording itself, or of the recording turned round. */
export function playedSpan(sample: Pick<Sample, "from" | "to" | "back">): [from: number, to: number] {
  return sample.back ? [1 - sample.to, 1 - sample.from] : [sample.from, sample.to];
}

// ---- how high ----------------------------------------------------------------------------

/** The note at which a ring that plays notes plays a sample as it is: the key's root in the ring's own octave. `null` for a ring that plays no notes. */
export function homeMidi(root: number, track: number): number | null {
  const center = [null, null, null, 46, 36, 60, 63][track] ?? null;
  return center === null ? null : rootNear(root, center);
}

/**
 * How many semitones above its own pitch a hit plays a sample. As a hit: its tuning, and for a ring that plays notes
 * the note against the ring's home note, for a drum its step's place across the ring (a semitone a place). In slices:
 * its tuning only (there the place across the ring picks the slice).
 */
export function hitSemitones(sample: Pick<Sample, "mode" | "tune">, midi: number | null, home: number | null, pitch: number): number {
  if (sample.mode === SLICES) return sample.tune;
  return sample.tune + (midi !== null && home !== null ? midi - home : pitch);
}

/** A number of semitones as how much faster (or slower) a recording runs. */
export const rateOf = (semitones: number): number => 2 ** (semitones / 12);

/**
 * How fast a slice runs. Chopped, as fast as its tuning says. With "Speed", as fast as it has to for filling its
 * step: a slice `sliceSeconds` long in a step `stepSeconds` long (its tuning comes on top, and so it no longer fills it
 * exactly: tuned up, it is over before its step is).
 */
export function sliceRate(sample: Pick<Sample, "fit" | "tune">, sliceSeconds: number, stepSeconds: number): number {
  const tuned = rateOf(sample.tune);
  if (sample.fit !== SPEED || stepSeconds <= 0 || sliceSeconds <= 0) return tuned;
  return clamp(sliceSeconds / stepSeconds, 0.25, 4) * tuned;
}

/**
 * How many times as long the played part is made at its own pitch before it is played (src/stretch.ts). As a hit, as
 * its own amount says. In slices with "Stretch": until `steps` steps hold exactly all of it, `partSeconds` long, at
 * its tuning (tuned up it runs faster, so it has to be made that much longer). Otherwise it is as it is: 1.
 */
export function stretchOf(sample: Pick<Sample, "mode" | "fit" | "tune" | "stretch">, partSeconds: number, steps: number, stepSeconds: number): number {
  if (sample.mode !== SLICES) return clamp(sample.stretch, 1, STRETCH_MAX);
  if (sample.fit !== STRETCH || !(partSeconds > 0) || !(stepSeconds > 0)) return 1;
  return clamp((steps * stepSeconds * rateOf(sample.tune)) / partSeconds, FIT_LEAST, STRETCH_MAX);
}

/** The key's root as a pitch in Hz (in the octave below middle C; which octave does not matter to what asks). */
export const rootHz = (root: number): number => 440 * 2 ** ((48 + wrap(Math.round(root), 12) - 69) / 12);

// ---- the sound pad ---------------------------------------------------------------------

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;

/**
 * What the sound pad's width does to a sample: in the middle it is as it is; to the left a low-pass closes over it
 * (down to 300 Hz), to the right a high-pass thins it (up to 2 kHz). `null` in the middle: no filter at all.
 */
export function padFilter(x: number): { type: "lowpass" | "highpass"; hz: number } | null {
  const across = clamp(x, 0, 1);
  if (across < 0.44) return { type: "lowpass", hz: expo(18_000, 300, (0.44 - across) / 0.44) };
  if (across > 0.56) return { type: "highpass", hz: expo(30, 2000, (across - 0.56) / 0.44) };
  return null;
}

/** What the pad's height does to a hit: in its upper half the recording plays out; below, less and less of it (a twentieth at the bottom). */
export const padLength = (y: number): number => (y >= 0.5 ? 1 : expo(0.05, 1, clamp(y, 0, 0.5) / 0.5));

/** The same in slices, in steps: in the upper half a hit plays on until the next comes (`null`: no end of its own); below, for sixteen steps down to a quarter of one. */
export const padSteps = (y: number): number | null => (y >= 0.5 ? null : expo(0.25, 16, clamp(y, 0, 0.5) / 0.5));

// ---- in words ----------------------------------------------------------------------------

/** Seconds as a person says them: "0.42 s", "3.2 s", "12 s". */
export function secondsText(seconds: number): string {
  return seconds < 1 ? `${seconds.toFixed(2)} s` : seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`;
}

/** A tuning as a person says it: "as it is", "+3 semitones", "−1.5 semitones". */
export function tuneText(tune: number): string {
  if (tune === 0) return "as it is";
  const size = Math.abs(tune);
  return `${tune > 0 ? "+" : "−"}${Number.isInteger(size) ? size : size.toFixed(2).replace(/0$/, "")} ${size === 1 ? "semitone" : "semitones"}`;
}

/** A stretch as a person says it: "2", "1.5". */
export const stretchText = (stretch: number): string => String(Math.round(stretch * 100) / 100);

/** A ring's sample in a line: its name, how it is played, and how long the part is that plays (when the recording's length is known). */
export function describeSample(sample: Sample, seconds: number | null, steps: number): string {
  const length = seconds === null ? "" : `, ${secondsText(seconds * (sample.to - sample.from))}`;
  const how = sample.mode === SLICES ? `${steps} slices${sample.fit === SPEED ? ", sped to the steps" : sample.fit === STRETCH ? ", stretched to the steps" : ""}` : `a one-shot${sample.stretch > 1 ? `, stretched ×${stretchText(sample.stretch)}` : ""}`;
  const extras = [sample.tune === 0 ? "" : tuneText(sample.tune), sample.back ? "backwards" : ""].filter(Boolean).join(", ");
  return `“${sample.name}”, ${how}${length}${extras ? `, ${extras}` : ""}`;
}
