/*
 * What a ready-made sound is made of, as plain numbers. The palettes beside
 * this file say what there is to choose from; src/audio/sounds.ts turns a
 * recipe into sound. Nothing here knows of a sound card.
 *
 * Two kinds of recipe: a struck sound for the four drum rings, made of
 * parts that ring out, and a played sound for the three rings that play
 * notes, made of oscillators through a filter.
 */

/** A filter: type, Hz, Q, and gain in dB for peaks and palettes. */
export type FilterRow = readonly [type: BiquadFilterType, hz: number, q?: number, gain?: number];

export const hp = (hz: number): FilterRow => ["highpass", hz];
export const lp = (hz: number, q = 0.7): FilterRow => ["lowpass", hz, q];
export const bp = (hz: number, q = 1): FilterRow => ["bandpass", hz, q];
/** A peak of `gain` dB. */
export const pk = (hz: number, q: number, gain: number): FilterRow => ["peaking", hz, q, gain];

// ---- struck sounds ------------------------------------------------------------

interface Struck {
  level: number;
  /** Seconds until it has died away; the pad's length stretches it. */
  decay: number;
  attack?: number;
  /** Seconds after the hit at which this part begins. */
  after?: number;
  /** As long as it is, wherever the pad's point is: a click. */
  tight?: boolean;
}

/** A struck oscillator. */
export interface TonePart extends Struck {
  tone: OscillatorType;
  /** Where it sounds: Hz for kick, snare and hi-hat, a multiple of the played note for the tuned drum. */
  at: number;
  /** The pitch moves to `to` (counted like `at`) within `seconds`. */
  fall?: readonly [to: number, seconds: number];
  /** Its frequency is counted like `at`. */
  filter?: FilterRow;
}

/** A struck burst of noise through filters. */
export interface NoisePart extends Struck {
  noise: readonly FilterRow[];
}

/** Three quick bursts of noise around `clap` Hz and a tail, whose length the pad moves between the two seconds of `tail`. */
export interface ClapPart {
  clap: number;
  level: number;
  tail: readonly [short: number, long: number];
  after?: number;
}

export type Part = TonePart | NoisePart | ClapPart;

export interface Drum {
  parts: readonly Part[];
  /** 0..1: how hard the sound is pushed into distortion. */
  drive?: number;
}

export const tone = (wave: OscillatorType, at: number, level: number, decay: number, more: Partial<Omit<TonePart, "tone" | "at" | "level" | "decay">> = {}): TonePart => ({ tone: wave, at, level, decay, ...more });

export const noise = (filters: readonly FilterRow[], level: number, decay: number, more: Partial<Omit<NoisePart, "noise" | "level" | "decay">> = {}): NoisePart => ({ noise: filters, level, decay, ...more });

/** A tick of bright noise at the very start. */
export const click = (hz: number, level: number): NoisePart => ({ noise: [hp(hz)], level, decay: 0.008, attack: 0.0005, tight: true });

export const clap = (hz: number, level: number, tail: readonly [number, number], after?: number): ClapPart => (after === undefined ? { clap: hz, level, tail } : { clap: hz, level, tail, after });

// ---- played sounds ------------------------------------------------------------

/**
 * One oscillator: its wave, its level (a pair follows the pad's brightness
 * from the first to the second), cents off the note, the multiple of the note
 * it plays, and whether it goes past the filter.
 */
export type OscRow = readonly [wave: OscillatorType, level?: number | readonly [dull: number, bright: number], cents?: number, times?: number, direct?: boolean];

export interface Tone {
  oscs: readonly OscRow[];
  /**
   * A filter the pad's brightness moves from `from` to `to` Hz. `env` opens
   * it at the strike to so many times its rest and lets it close within so
   * many seconds; a number below 1 starts closed and opens up. With a second
   * time, the pad's length moves the time between the two.
   */
  filter?: { type?: BiquadFilterType; from: number; to: number; q?: number; env?: readonly [open: number, seconds: number, secondsLong?: number] };
  /**
   * Frequency modulation: a sine at `times` the note moves the pitch of the
   * oscillators. The pad's brightness moves its depth between the two numbers
   * of `index` (multiples of the note's frequency); after the strike it
   * settles at `settle` of that (0.1) with the time constant `seconds` (0.15).
   */
  fm?: { times: number; index: readonly [dull: number, bright: number]; settle?: number; seconds?: number };
  /**
   * How loud it is over time. Held: attack, the share it sustains at, the
   * time it takes to get there, and the release, which the pad's length moves
   * between the last two. Struck: it dies away within a time the pad's length
   * moves between the two, after an attack of 3 ms unless said.
   */
  amp: readonly ["hold", attack: number, sustain: number, decay: number, release: number, releaseLong: number] | readonly ["strike", decay: number, decayLong: number, attack?: number];
  level: number;
  /** Cents, seconds before it starts (0.2), seconds it takes to arrive (0.2), and its speed in Hz (5.4). */
  vibrato?: readonly [cents: number, delay?: number, rise?: number, rate?: number];
  /** Tied notes slide into each other. */
  glide?: boolean;
  /** Every note slides into place from this multiple of itself within so many seconds. */
  bend?: readonly [from: number, seconds: number];
  /** A burst of noise at the strike: a breath, a pick, a hammer. */
  noise?: readonly [filter: FilterRow, level: number, decay: number, attack?: number];
  /** 0..1: how hard the sound is pushed into distortion. */
  drive?: number;
}

export const hold = (attack: number, sustain: number, decay: number, release: number, releaseLong: number): Tone["amp"] => ["hold", attack, sustain, decay, release, releaseLong];

export const strike = (decay: number, decayLong: number, attack = 0.003): Tone["amp"] => ["strike", decay, decayLong, attack];

// ---- the palette ----------------------------------------------------------------

/** A sound on the palette: its name, and either one of the ring's four classics (played as ever) or a recipe. */
export type Listed<Recipe> = { name: string } & ({ classic: number } | Recipe);

/** Ten sounds that belong together. */
export interface Family<Recipe> {
  name: string;
  sounds: readonly Listed<Recipe>[];
}

/** A ring's palette: five families of ten. The first four are led by the ring's four classics. */
export type Palette<Recipe> = readonly Family<Recipe>[];
