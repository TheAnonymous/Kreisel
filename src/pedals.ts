import { clamp, MAX_STEPS, type Pedals, type Track } from "./model";
import { driven, ringGains } from "./press";

/*
 * A ring's pedals. Acid and hard techno are made with a handful of boxes on
 * the floor and the order they stand in: a distortion behind the bass
 * machine, a flanger on the hi-hats, a crusher on the drums, and a reverb
 * that runs INTO the distortion instead of out of it. So every ring but the
 * kick (which has a chain of its own) can have:
 *
 *  - a character for its Drive: warm (as a Kreisel always drove), distortion,
 *    fuzz, clip, scream;
 *  - "Crush": fewer levels and fewer samples a second;
 *  - a modulation: phaser, flanger or chorus. A phaser's or a flanger's sweep
 *    is not left to a clock of its own: its top is a place on the ring (the
 *    "crest"), so it is in time and the same in every round;
 *  - an order: whether the ring's reverb and echo come after the drive (a
 *    clean room) or before it (the drive chews on the tail and the repeats).
 *
 * Everything here is plain arithmetic and words. src/audio/pedals.ts makes it
 * sound.
 */

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const share01 = (value: number): number => Math.min(1, Math.max(0, value));

// ---- what a ring has -----------------------------------------------------------------

/** The kick is made hard by its own chain (Hardness, Rumble); every other ring can have pedals. */
export const takesPedals = (track: number): boolean => track > 0;

/** A board fresh out of the box: nothing on, and a modulation that would sweep once in two rounds. */
export function noPedals(): Pedals {
  return { tone: 0, crush: 0, mod: 0, depth: 0.4, crest: 0, span: 2, first: 0 };
}

/** The pedals of a ring, or a fresh board where it has none. */
export const pedalsOf = (track: Pick<Track, "pedals">): Pedals => track.pedals ?? noPedals();

/** Whether pedals say anything at all: a board on which nothing is on is no board. */
export const pedalsSay = (pedals: Pedals): boolean => pedals.tone > 0 || pedals.crush > 0 || pedals.mod > 0 || pedals.first > 0;

/** Pedals from whatever claims to be some: every number in its range, and nothing at all where nothing is on. */
export function cleanPedals(value: unknown): Pedals | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const claim = value as Partial<Record<keyof Pedals, unknown>>;
  const fresh = noPedals();
  const whole = (amount: unknown, high: number, fallback: number): number => (typeof amount === "number" && Number.isFinite(amount) ? clamp(Math.round(amount), 0, high) : fallback);
  const share = (amount: unknown, fallback: number): number => (typeof amount === "number" && Number.isFinite(amount) ? clamp(amount, 0, 1) : fallback);
  const pedals: Pedals = {
    tone: whole(claim.tone, TONES.length - 1, fresh.tone),
    crush: share(claim.crush, fresh.crush),
    mod: whole(claim.mod, MODS.length - 1, fresh.mod),
    depth: share(claim.depth, fresh.depth),
    crest: whole(claim.crest, MAX_STEPS - 1, fresh.crest),
    span: whole(claim.span, SPANS.length - 1, fresh.span),
    first: whole(claim.first, 3, fresh.first),
  };
  return pedalsSay(pedals) ? pedals : undefined;
}

/** Pedals as a link carries them: seven small numbers, the two amounts in hundredths. */
export function packPedals(pedals: Pedals): string {
  return [pedals.tone, Math.round(pedals.crush * 100), pedals.mod, Math.round(pedals.depth * 100), pedals.crest, pedals.span, pedals.first].join(".");
}

/** Pedals from a link; anything else is no pedals. */
export function unpackPedals(value: unknown): Pedals | undefined {
  if (typeof value !== "string" || value.length > 28) return undefined;
  const parts = value.split(".").map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (parts.length !== 7 || parts.some((part) => Number.isNaN(part))) return undefined;
  const [tone = 0, crush = 0, mod = 0, depth = 0, crest = 0, span = 0, first = 0] = parts;
  return cleanPedals({ tone, crush: crush / 100, mod, depth: depth / 100, crest, span, first });
}

// ---- the drive's character -----------------------------------------------------------

export const WARM = 0;
export const DISTORTION = 1;
export const FUZZ = 2;
export const CLIP = 3;
export const SCREAM = 4;

/** The characters, from mild to harsh. */
export const TONES = [
  { name: "Warm", hint: "Soft saturation that rounds the peaks off: the drive a Kreisel always had" },
  { name: "Distortion", hint: "The hard pedal behind an acid line: the lows are thinned before it clips and given back after, so the resonance survives" },
  { name: "Fuzz", hint: "Lopsided and buzzing: it swallows what is quiet and tears at what is loud" },
  { name: "Clip", hint: "Cut off flat at the top: dry, dense and hard, the way hard techno drums are" },
  { name: "Scream", hint: "A ringing peak pushed into a clipper, the lows cut away after: the screech. The drive's amount moves the peak" },
] as const;

/** What a station of the chain is called for a character: the warm one is simply the drive. */
export const toneStation = (tone: number): string => (tone === WARM ? "Drive" : (TONES[tone]?.name ?? "Drive"));

/** A clipper with a knee: as it comes up to `knee`, then rounding off towards 1. */
const kneed = (value: number, knee: number): number => {
  const size = Math.abs(value);
  return size <= knee ? value : Math.sign(value) * (knee + (1 - knee) * Math.tanh((size - knee) / (1 - knee)));
};

/** What a character makes of a sample that reaches its shaper, −1..1 in and out. */
export function toneShape(tone: number, x: number): number {
  const input = clamp(x, -1, 1);
  if (tone === DISTORTION) return kneed(input * 3, 0.6);
  if (tone === FUZZ) {
    // A dead stretch around nothing (what is quiet falls silent), and two unequal halves.
    const size = Math.max(0, Math.abs(input) - 0.012);
    return input >= 0 ? 1 - Math.exp(-5 * size) : -0.8 * (1 - Math.exp(-9 * size));
  }
  if (tone === CLIP) return clamp(input * 2.5, -1, 1) * 0.95;
  if (tone === SCREAM) return clamp(input * 3, -1, 1) * 0.95;
  return Math.tanh(input * 2.5);
}

/** A character as the curve of a shaper. The warm one is, number for number, the curve every ring always had. */
export function toneCurve(tone: number, points = 2049): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const middle = (points - 1) / 2;
  for (let index = 0; index < points; index += 1) curve[index] = toneShape(tone, index / middle - 1);
  return curve;
}

export interface ToneFilters {
  /** Before the shaper: the lows thinned, or a peak that rings. */
  pre: { type: "highpass" | "peaking"; hz: number; q: number; gain: number };
  /** After it: the fizz tamed, or the lows cut away. */
  post: { type: "lowpass" | "highpass"; hz: number; q: number };
  /** Below this the clean sound passes beside the shaper, so the bass is given back (0: no such path). */
  lows: number;
}

/**
 * The filters around a character's shaper at an amount of 0..1; `null` for the warm one, which has none. Thinning
 * the bass before a clipper and giving it back afterwards is what keeps a resonance alive in it.
 */
export function toneFilters(tone: number, amount: number): ToneFilters | null {
  const much = share01(amount);
  if (tone === DISTORTION) return { pre: { type: "highpass", hz: 200, q: 0.7, gain: 0 }, post: { type: "lowpass", hz: 6500, q: 0.7 }, lows: 200 };
  if (tone === FUZZ) return { pre: { type: "highpass", hz: 110, q: 0.7, gain: 0 }, post: { type: "lowpass", hz: 5200, q: 0.7 }, lows: 110 };
  if (tone === CLIP) return { pre: { type: "highpass", hz: 30, q: 0.7, gain: 0 }, post: { type: "lowpass", hz: 16_000, q: 0.7 }, lows: 0 };
  // The scream: the more it is driven, the higher its peak rings.
  if (tone === SCREAM) return { pre: { type: "peaking", hz: expo(900, 2400, much), q: 5, gain: 8 + 10 * much }, post: { type: "highpass", hz: 200, q: 0.7 }, lows: 0 };
  return null;
}

/** How hard each character is pushed into its shaper from nothing to all of it, how loud it comes back, and how much of the clean lows passes beside it. */
const PUSH: readonly (readonly [low: number, high: number, wet: number, lows: number])[] = [[1.2, 5, 0.27, 0], [2, 9, 0.3, 0.9], [2.5, 12, 0.3, 0.6], [1.5, 10, 0.3, 0], [1.2, 5, 0.26, 0]];

/**
 * What a ring's own drive is turned up or down by for each character but the warm one (which has its own, see
 * `driveTrim`), in dB along the control: so that a character changes how the ring sounds, not how loud it is.
 * Measured with `scripts/level-pedals.mjs` on the six rings of the plain techno Kreisel, each by itself: with these
 * numbers every character is, on average over the rings, as loud as the warm one at the same drive. A single ring
 * can lie a few dB off that (a low drum loses its body to the scream, which cuts the lows away).
 */
const TONE_TRIM: readonly (readonly (readonly [drive: number, dB: number])[])[] = [
  [],
  [[0, 0], [0.25, 0.1], [0.5, -1], [0.75, -2.4], [1, -3.7]],
  [[0, 0], [0.25, 0.6], [0.5, -0.3], [0.75, -1.7], [1, -3.4]],
  [[0, 0], [0.25, 0.6], [0.5, -0.3], [0.75, -2.5], [1, -4.4]],
  [[0, 0], [0.25, 1], [0.5, 1.4], [0.75, 0.7], [1, -0.7]],
];

/** A table of dB along a control, read between its points, as a factor. */
function trimAt(table: readonly (readonly [at: number, dB: number])[], value: number): number {
  const much = share01(value);
  const after = Math.max(1, table.findIndex(([at]) => at >= much));
  const [highAt, high] = table[after] ?? [1, 0];
  const [lowAt, low] = table[after - 1] ?? [0, 0];
  return 10 ** ((low + ((high - low) * (much - lowAt)) / (highAt - lowAt)) / 20);
}

export const toneTrim = (tone: number, drive: number): number => (tone === WARM ? 1 : trimAt(TONE_TRIM[tone] ?? [], drive));

export interface PedalGains {
  dry: number;
  push: number;
  wet: number;
  /** The clean lows beside the shaper. */
  lows: number;
}

/**
 * The gains around a ring's shaper for its character, its own drive and the sparks that lie on it right now. For
 * the warm character these are the numbers a ring always had.
 */
export function pedalGains(tone: number, drive: number, sparks: number): PedalGains {
  if (tone === WARM || !PUSH[tone]) return { ...ringGains(drive, sparks), lows: 0 };
  const [low, high, wet, lows] = PUSH[tone];
  const much = driven(drive, sparks);
  const trim = toneTrim(tone, drive);
  return { dry: (1 - much * 0.9) * trim, push: expo(low, high, much), wet: much * wet * trim, lows: much * lows * trim };
}

// ---- crush ---------------------------------------------------------------------------

/** How many bits are left at an amount of 0..1 (with fractions: the levels need not be a power of two). */
export const crushBits = (amount: number): number => 9 - 6.6 * share01(amount) ** 0.8;
/** How often a second the sound is still looked at. */
export const crushRate = (amount: number): number => expo(18_000, 1600, share01(amount));

/** Levels instead of a line: `bits` of them either way. */
export function stairCurve(bits: number, points = 8193): Float32Array<ArrayBuffer> {
  const levels = 2 ** bits;
  const curve = new Float32Array(points);
  const middle = (points - 1) / 2;
  for (let index = 0; index < points; index += 1) curve[index] = Math.round((index / middle - 1) * levels) / levels;
  return curve;
}

/**
 * The share of the time between two looks for which the crusher looks at the sound: an eighth. Laid out eight times
 * side by side (`HOLD_SHARES`), such a pulse fills that time exactly, and the sound is held from one look to the next.
 */
export const PULSE_DUTY = 1 / 8;
/** The three delays that lay a pulse out eight times, as shares of the time between two looks. */
export const HOLD_SHARES = [1 / 2, 1 / 4, 1 / 8] as const;

/**
 * The overtones of the pulses a crusher looks at the sound with, for a periodic wave: a sound multiplied by them
 * (and by 1 for their mean) is the sound sampled at their rate, mirror images and all.
 */
export function pulseHarmonics(count = 48): Float32Array<ArrayBuffer> {
  const real = new Float32Array(count + 1);
  for (let harmonic = 1; harmonic <= count; harmonic += 1) real[harmonic] = (2 * Math.sin(Math.PI * harmonic * PULSE_DUTY)) / (Math.PI * harmonic * PULSE_DUTY);
  return real;
}

/**
 * How much passes beside the crusher and how much through it: the first tenth of the control fades it in. It needs
 * no levelling: held from look to look, a sound is as loud as it was (measured with `scripts/level-pedals.mjs`:
 * within 0.3 dB on average over the six rings, all along the control; a hi-hat loses 3 dB at the very end, where
 * little of it lies below the rate).
 */
export function crushGains(amount: number): { dry: number; wet: number } {
  const taken = Math.min(1, share01(amount) / 0.1);
  return { dry: 1 - taken, wet: taken };
}

/** How crushed that is, in a word. */
export function crushWord(amount: number): string {
  const much = share01(amount);
  return much === 0 ? "off" : much <= 0.2 ? "light" : much <= 0.45 ? "grainy" : much <= 0.7 ? "8-bit" : much <= 0.9 ? "crunchy" : "broken";
}

// ---- modulation ----------------------------------------------------------------------

export const PHASER = 1;
export const FLANGER = 2;
export const CHORUS = 3;

export const MODS = [
  { name: "Off", hint: "No modulation" },
  { name: "Phaser", hint: "Notches that travel through the sound: the swirl on an acid line" },
  { name: "Flanger", hint: "A comb that sweeps: the jet over hi-hats and rides" },
  { name: "Chorus", hint: "Slowly swaying copies: wide and thick, for chords and hoovers" },
] as const;

/** Whether a modulation sweeps, and so has a crest on the ring. */
export const sweeps = (mod: number): boolean => mod === PHASER || mod === FLANGER;

/** How long one sweep can take, in rounds of the ring. */
export const SPANS = [0.5, 1, 2, 4, 8] as const;
export const SPAN_NAMES = ["twice a round", "every round", "every 2 rounds", "every 4 rounds", "every 8 rounds"] as const;
export const SPAN_SHORT = ["½", "1", "2", "4", "8"] as const;
/** How long one sweep takes, as a screen reader says it. */
export const SPAN_SAYS = ["half a round", "one round", "two rounds", "four rounds", "eight rounds"] as const;

/**
 * Where a sweep stands after `local` steps of playing on a ring of `length` steps: 0 at its bottom, 1 at its top.
 * It is at its top when the ring's runner passes `crest`, in every round or in every so many.
 */
export function sweepAt(local: number, length: number, crest: number, span: number): number {
  const period = Math.max(1, length) * (SPANS[span] ?? 1);
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * (local - crest)) / period);
}

/** The steps of one round on which a sweep is at its top: one, or two for a sweep that goes twice a round. */
export function crestSteps(length: number, crest: number, span: number): number[] {
  const at = ((crest % length) + length) % length;
  return (SPANS[span] ?? 1) < 1 ? [at, (at + length / 2) % length] : [at];
}

/** The four stages of the phaser, as factors of where the sweep stands. */
export const PHASER_STAGES = [0.62, 1, 1.62, 2.62] as const;
/** Where the phaser's notches sit for a sweep of 0..1, in Hz. */
export const phaserHz = (value: number): number => expo(240, 3800, share01(value));
/** How far the flanger's comb is delayed for a sweep of 0..1, in seconds: shortest (brightest) at the top. */
export const flangerSeconds = (value: number): number => expo(0.0072, 0.00055, share01(value));
/** The shortest time the loop that makes the flanger ring can have: a browser delays a loop by at least one block. */
export const FLANGER_LOOP_MIN = 0.0032;

/**
 * The gains of a modulation at a depth of 0..1: the clean sound, what went through the effect, and how much of that
 * is fed back. Clean and effect together are as loud as the clean sound alone.
 */
export function modGains(mod: number, depth: number): { dry: number; wet: number; feedback: number } {
  const deep = share01(depth);
  if (mod <= 0 || deep === 0) return { dry: 1, wet: 0, feedback: 0 };
  const wet = mod === CHORUS ? 0.85 * deep : mod === FLANGER ? 0.8 * deep ** 0.7 : deep ** 0.7;
  const even = 1 / Math.sqrt(1 + wet * wet);
  return { dry: even, wet: wet * even, feedback: mod === FLANGER ? 0.62 * deep ** 0.5 : 0 };
}

/** The place of the crest as a screen reader says it. */
export const crestText = (crest: number, length: number): string => `step ${(((crest % length) + length) % length) + 1} of ${length}`;

// ---- the order -----------------------------------------------------------------------

export const ORDERS = [
  { name: "Clean space", hint: "Drive first, then echo and reverb: the room stays clean, as it always was" },
  { name: "Reverb into drive", hint: "The reverb comes before the drive: the tail is driven too and swells between the hits (the wash of hard techno)" },
  { name: "Echo into drive", hint: "The echo comes before the drive: the repeats bite and smear into each other" },
  { name: "Both into drive", hint: "Echo and reverb both come before the drive: a wall" },
] as const;

export const reverbFirst = (pedals: Pedals | undefined): boolean => ((pedals?.first ?? 0) & 1) !== 0;
export const echoFirst = (pedals: Pedals | undefined): boolean => ((pedals?.first ?? 0) & 2) !== 0;

/**
 * How loud the room and the echo in front of a ring's drive come back into it. The room is short and comes back
 * loud: only then does the drive get hold of the tail and bring it up between the hits, which is the point of
 * putting a reverb in front of a distortion (measured on the techno Kreisel's clap: about 10 dB more tail).
 */
export const ROOM_LEVEL = 2.4;
export const FRONT_ECHO = { feedback: 0.4, tone: 3400, level: 0.75 } as const;

// ---- the chain, in words -------------------------------------------------------------

type Worn = Pick<Track, "drive" | "hall" | "echo" | "pedals">;

/** What a ring's sound passes, in the order it passes it. Only what is turned up is named. */
export function stations(track: Worn): string[] {
  const pedals = pedalsOf(track);
  const before = [...(track.echo > 0 && echoFirst(pedals) ? ["Echo"] : []), ...(track.hall > 0 && reverbFirst(pedals) ? ["Reverb"] : [])];
  const after = [...(track.echo > 0 && !echoFirst(pedals) ? ["Echo"] : []), ...(track.hall > 0 && !reverbFirst(pedals) ? ["Reverb"] : [])];
  return [
    ...before,
    ...(track.drive > 0 ? [toneStation(pedals.tone)] : []),
    ...(pedals.crush > 0 ? ["Crush"] : []),
    ...(pedals.mod > 0 && pedals.depth > 0 ? [MODS[pedals.mod]?.name ?? ""] : []),
    ...after,
  ];
}

/** The chain as one line, in words that can be read out: "Echo, then Distortion, then Phaser, then Reverb", or that there is none. */
export function describeChain(track: Worn): string {
  const names = stations(track);
  return names.length > 0 ? names.join(", then ") : "nothing in its way";
}

// ---- chains: boards the genre knows --------------------------------------------------

export interface ChainPreset {
  name: string;
  /** What it is for. */
  hint: string;
  drive: number;
  hall: number;
  echo: number;
  pedals: Pedals;
}

const board = (change: Partial<Pedals>): Pedals => ({ ...noPedals(), ...change });

/**
 * Five boards for each ring but the kick, as acid and hard techno are made (see the research notes the plan names):
 * the distortion behind the acid line and the echo behind that, the reverb in front of the clipper, the flanger over
 * the hi-hats, the crusher behind the overdrive on industrial drums, the peak into the clipper for a screech.
 */
export const CHAINS: readonly (readonly ChainPreset[])[] = [
  [],
  [
    { name: "Warehouse clap", hint: "A long room in front of the distortion: the clap that fills a hall", drive: 0.5, hall: 0.45, echo: 0, pedals: board({ tone: DISTORTION, first: 1 }) },
    { name: "Crushed snare", hint: "Overdrive, then the crusher: industrial", drive: 0.35, hall: 0.1, echo: 0, pedals: board({ crush: 0.5 }) },
    { name: "Clip clap", hint: "Cut off flat: dry and hard", drive: 0.6, hall: 0.08, echo: 0, pedals: board({ tone: CLIP }) },
    { name: "Dub snare", hint: "The echo in front of the drive: the repeats bite", drive: 0.35, hall: 0.1, echo: 0.3, pedals: board({ first: 2 }) },
    { name: "Tight room", hint: "A little distortion and a short clean room behind it", drive: 0.3, hall: 0.2, echo: 0, pedals: board({ tone: DISTORTION }) },
  ],
  [
    { name: "Jet hats", hint: "A flanger that sweeps once in four rounds: the jet over the hi-hats", drive: 0.15, hall: 0.03, echo: 0, pedals: board({ mod: FLANGER, depth: 0.35, span: 3 }) },
    { name: "Tin foil", hint: "A little crush on a little drive: brittle and bright", drive: 0.2, hall: 0.03, echo: 0, pedals: board({ crush: 0.35 }) },
    { name: "Schranz top", hint: "Clipped flat with a flanger on top", drive: 0.6, hall: 0, echo: 0, pedals: board({ tone: CLIP, mod: FLANGER, depth: 0.25, span: 2 }) },
    { name: "Dirty ride", hint: "Distortion and a slow phaser", drive: 0.45, hall: 0.05, echo: 0, pedals: board({ tone: DISTORTION, mod: PHASER, depth: 0.3, span: 3 }) },
    { name: "Hard and dry", hint: "Only the clipper", drive: 0.4, hall: 0, echo: 0, pedals: board({ tone: CLIP }) },
  ],
  [
    { name: "Industrial", hint: "Overdrive, then the crusher", drive: 0.5, hall: 0.1, echo: 0, pedals: board({ crush: 0.55 }) },
    { name: "Metal", hint: "A deep flanger that goes round with the ring: the drum rings like a pipe", drive: 0.3, hall: 0.1, echo: 0, pedals: board({ tone: DISTORTION, mod: FLANGER, depth: 0.75, span: 1 }) },
    { name: "Rumble tom", hint: "The reverb in front of the distortion: a drum with a cellar", drive: 0.5, hall: 0.4, echo: 0, pedals: board({ tone: DISTORTION, first: 1 }) },
    { name: "Schranz loop", hint: "The echo in front of a clipper: repeats pressed flat", drive: 0.65, hall: 0.05, echo: 0.22, pedals: board({ tone: CLIP, first: 2 }) },
    { name: "Space drum", hint: "A phaser, then echo and reverb", drive: 0.15, hall: 0.3, echo: 0.35, pedals: board({ mod: PHASER, depth: 0.4, span: 2 }) },
  ],
  [
    { name: "Acid classic", hint: "Distortion behind the line, the echo behind that, a little room", drive: 0.5, hall: 0.08, echo: 0.2, pedals: board({ tone: DISTORTION }) },
    { name: "Hard acid", hint: "The clipper, and next to nothing else", drive: 0.65, hall: 0, echo: 0.08, pedals: board({ tone: CLIP }) },
    { name: "Acid wash", hint: "The reverb in front of the drive: the tail sticks to the line and pumps", drive: 0.55, hall: 0.3, echo: 0, pedals: board({ first: 1 }) },
    { name: "Dub acid", hint: "No drive at all: echo and reverb carry the line", drive: 0, hall: 0.25, echo: 0.4, pedals: board({ mod: PHASER, depth: 0.25, span: 3 }) },
    { name: "Phased acid", hint: "Distortion, then a phaser that sweeps once in four rounds", drive: 0.4, hall: 0.05, echo: 0.15, pedals: board({ tone: DISTORTION, mod: PHASER, depth: 0.5, span: 3 }) },
  ],
  [
    { name: "Stab wall", hint: "The reverb in front of a clipper: every stab is a wall", drive: 0.5, hall: 0.4, echo: 0.1, pedals: board({ tone: CLIP, first: 1 }) },
    { name: "Chorus pad", hint: "Wide and thick, in a clean room", drive: 0, hall: 0.35, echo: 0.1, pedals: board({ mod: CHORUS, depth: 0.6 }) },
    { name: "Dub chords", hint: "The echo in front of the drive: the repeats smear into each other", drive: 0.4, hall: 0.2, echo: 0.4, pedals: board({ first: 2 }) },
    { name: "Phaser stab", hint: "A little distortion and a phaser that goes round with the ring", drive: 0.3, hall: 0.2, echo: 0.2, pedals: board({ tone: DISTORTION, mod: PHASER, depth: 0.55, span: 2 }) },
    { name: "Rave stab", hint: "Distortion and a little crush, echo behind", drive: 0.5, hall: 0.2, echo: 0.25, pedals: board({ tone: DISTORTION, crush: 0.2 }) },
  ],
  [
    { name: "Screech", hint: "The ringing peak into the clipper, echo and reverb behind", drive: 0.6, hall: 0.25, echo: 0.25, pedals: board({ tone: SCREAM }) },
    { name: "Rave lead", hint: "A warm drive, a long echo, a big room", drive: 0.5, hall: 0.3, echo: 0.35, pedals: board({ mod: CHORUS, depth: 0.3 }) },
    { name: "Hoover", hint: "Chorus on distortion: wide, thick and rude", drive: 0.35, hall: 0.2, echo: 0.1, pedals: board({ tone: DISTORTION, mod: CHORUS, depth: 0.75 }) },
    { name: "Fuzz acid", hint: "A fuzz behind the line, a short echo", drive: 0.55, hall: 0.05, echo: 0.2, pedals: board({ tone: FUZZ }) },
    { name: "Wall of sound", hint: "Echo and reverb both in front of a clipper", drive: 0.5, hall: 0.35, echo: 0.3, pedals: board({ tone: CLIP, first: 3 }) },
  ],
];

export const chainsFor = (track: number): readonly ChainPreset[] => CHAINS[track] ?? [];

const hundredths = (value: number): number => Math.round(value * 100);

/** Whether two boards do the same: what is off does not count (a crest is where one likes it). */
function sameBoard(one: Pedals, other: Pedals): boolean {
  if (one.tone !== other.tone || hundredths(one.crush) !== hundredths(other.crush) || one.first !== other.first || one.mod !== other.mod) return false;
  if (one.mod === 0) return true;
  return hundredths(one.depth) === hundredths(other.depth) && (!sweeps(one.mod) || one.span === other.span);
}

/** Which of the ring's chains it wears right now; −1 for none of them. */
export function chainWorn(track: number, settings: Worn): number {
  return chainsFor(track).findIndex((preset) => hundredths(preset.drive) === hundredths(settings.drive) && hundredths(preset.hall) === hundredths(settings.hall) && hundredths(preset.echo) === hundredths(settings.echo) && sameBoard(preset.pedals, pedalsOf(settings)));
}

/** Puts a chain on a ring: its drive, its reverb and echo, and its pedals. The crest stays where it was set. */
export function wearChain(settings: Track, preset: ChainPreset): void {
  const crest = pedalsOf(settings).crest;
  settings.drive = preset.drive;
  settings.hall = preset.hall;
  settings.echo = preset.echo;
  const pedals = cleanPedals({ ...preset.pedals, crest });
  if (pedals) settings.pedals = pedals;
  else delete settings.pedals;
}

/** A chain for a ring by the dice: any but the one it wears. */
export function diceChain(track: number, worn: number, random: () => number): number {
  const count = chainsFor(track).length;
  if (count === 0) return -1;
  const choices = Array.from({ length: count }, (_, index) => index).filter((index) => index !== worn);
  return choices[Math.floor(random() * choices.length)] ?? 0;
}
