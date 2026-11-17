import { BODY_KIND_COUNT, clamp, EXCITER_COUNT, type Body } from "./model";
import type { Random } from "./patterns";

/*
 * Klangkörper: instruments as things that ring. A body is not a recording
 * and not a synthesizer patch; it is a list of the ways it can vibrate (its
 * modes), each with a pitch, a strength and a time to die away. What the
 * body is decides the pitches, where it is struck decides the strengths,
 * its material decides how the modes die. Everything here is plain
 * arithmetic, so a body sounds the same live, in a WAV and in a test.
 */

export const BODY_NAMES = ["Fell", "Saite", "Stab", "Rohr", "Schale"] as const;
export const EXCITER_NAMES = ["Weich", "Hart", "Zupfen", "Streichen", "Blasen"] as const;
/** What the tightness of each body is called. */
export const TIGHT_NAMES = ["Spannung", "Spannung", "Dicke", "Enge", "Wandstärke"] as const;
/** Where a body is struck, from 0 to 1. */
export const WHERE_NAMES = [["Mitte", "Rand"], ["Mitte", "Ende"], ["Mitte", "Ende"], ["Boden", "Öffnung"], ["Bauch", "Rand"]] as const;

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;
const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
/** A value along wood, metal, glass. */
const along = (material: number, wood: number, metal: number, glass: number): number =>
  material < 0.5 ? lerp(wood, metal, material * 2) : lerp(metal, glass, (material - 0.5) * 2);

const hundredth = (value: unknown, fallback: number): number => {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.round(clamp(number, 0, 1) * 100) / 100;
};
const whole = (value: unknown, count: number): number => {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return clamp(number, 0, count - 1);
};

/** A body with every value where it may be (whatever came in). */
export function cleanBody(value: Partial<Record<keyof Body, unknown>>): Body {
  return {
    kind: whole(value.kind, BODY_KIND_COUNT),
    size: hundredth(value.size, 0.5),
    tight: hundredth(value.tight, 0.5),
    material: hundredth(value.material, 0.5),
    exciter: whole(value.exciter, EXCITER_COUNT),
    where: hundredth(value.where, 0.3),
  };
}

/** Bowed and blown bodies sound for as long as the note lasts. */
export const sustains = (body: Body): boolean => body.exciter >= 3;

// ---- starting points ------------------------------------------------------------

type Range = readonly [low: number, high: number];
interface Starter {
  kind: number;
  size: Range;
  tight: Range;
  material: Range;
  exciter: readonly number[];
  where: Range;
}

/** What a ring's dice reach for: bodies that suit what the ring is for. */
const STARTERS: readonly (readonly Starter[])[] = [
  // Kick: a big slack skin, hit in the middle.
  [
    { kind: 0, size: [0.78, 1], tight: [0.05, 0.4], material: [0, 0.3], exciter: [0, 0, 1], where: [0, 0.25] },
    { kind: 3, size: [0.92, 1], tight: [0.1, 0.5], material: [0, 0.4], exciter: [0], where: [0, 0.3] },
  ],
  // Snare: a small tight skin, or a piece of wood.
  [
    { kind: 0, size: [0.3, 0.52], tight: [0.6, 0.95], material: [0.1, 0.5], exciter: [1], where: [0.35, 0.9] },
    { kind: 2, size: [0.45, 0.7], tight: [0.5, 0.9], material: [0, 0.15], exciter: [1], where: [0.5, 1] },
  ],
  // Hi-hat: something small and hard that rings briefly.
  [
    { kind: 4, size: [0, 0.2], tight: [0.75, 1], material: [0.35, 0.6], exciter: [1], where: [0.6, 1] },
    { kind: 2, size: [0, 0.18], tight: [0.7, 1], material: [0.4, 0.65], exciter: [1], where: [0.7, 1] },
    { kind: 0, size: [0, 0.12], tight: [0.85, 1], material: [0.5, 0.7], exciter: [1], where: [0.6, 0.95] },
  ],
  // Tuned drum: skins, bars and bowls.
  [
    { kind: 0, size: [0.4, 0.8], tight: [0.3, 0.7], material: [0.1, 0.5], exciter: [0, 1], where: [0.1, 0.7] },
    { kind: 2, size: [0.3, 0.7], tight: [0.3, 0.7], material: [0, 0.3], exciter: [0, 1], where: [0, 0.6] },
    { kind: 4, size: [0.3, 0.7], tight: [0.3, 0.8], material: [0.4, 0.9], exciter: [0, 1], where: [0.3, 1] },
    { kind: 3, size: [0.4, 0.8], tight: [0.2, 0.6], material: [0, 0.5], exciter: [0, 1], where: [0, 0.5] },
  ],
  // Bass: a thick string, a wide tube, a long bar.
  [
    { kind: 1, size: [0.55, 1], tight: [0.2, 0.6], material: [0.35, 0.6], exciter: [2, 2, 0], where: [0.3, 0.8] },
    { kind: 3, size: [0.6, 1], tight: [0.1, 0.5], material: [0, 0.5], exciter: [4, 0], where: [0, 0.4] },
    { kind: 2, size: [0.6, 1], tight: [0.2, 0.5], material: [0, 0.25], exciter: [0], where: [0, 0.3] },
  ],
  // Chords: strings and bowls that ring into each other.
  [
    { kind: 1, size: [0.4, 0.8], tight: [0.4, 0.8], material: [0.4, 0.7], exciter: [2, 3], where: [0.3, 0.9] },
    { kind: 4, size: [0.4, 0.8], tight: [0.2, 0.6], material: [0.5, 1], exciter: [0, 3], where: [0.2, 0.8] },
    { kind: 2, size: [0.4, 0.8], tight: [0.2, 0.5], material: [0.45, 0.7], exciter: [0], where: [0, 0.4] },
  ],
  // Melody: bars, tubes, strings, glasses.
  [
    { kind: 2, size: [0.2, 0.6], tight: [0.4, 0.9], material: [0.4, 0.9], exciter: [1, 0], where: [0, 0.6] },
    { kind: 3, size: [0.3, 0.7], tight: [0.3, 0.8], material: [0, 0.6], exciter: [4], where: [0.1, 0.6] },
    { kind: 1, size: [0.3, 0.7], tight: [0.5, 0.9], material: [0.4, 0.7], exciter: [2, 3], where: [0.4, 0.95] },
    { kind: 4, size: [0.2, 0.6], tight: [0.3, 0.7], material: [0.7, 1], exciter: [0, 1, 3], where: [0.4, 1] },
  ],
];

/** A body for ring `track` to start from. */
export function diceBody(track: number, random: Random): Body {
  const starters = STARTERS[track] ?? STARTERS[3]!;
  const starter = starters[Math.floor(random() * starters.length) % starters.length]!;
  const within = (range: Range): number => lerp(range[0], range[1], random());
  return cleanBody({
    kind: starter.kind,
    size: within(starter.size),
    tight: within(starter.tight),
    material: within(starter.material),
    exciter: starter.exciter[Math.floor(random() * starter.exciter.length) % starter.exciter.length],
    where: within(starter.where),
  });
}

const third = <T>(value: number, words: readonly [T, T, T]): T => words[value < 0.34 ? 0 : value < 0.67 ? 1 : 2];

export const materialName = (material: number): string => (material < 0.25 ? "Holz" : material < 0.42 ? "hartes Holz" : material < 0.62 ? "Metall" : material < 0.8 ? "helles Metall" : "Glas");

/** A body in a few words, for the status line. */
export function describeBody(body: Body | null): string {
  if (!body) return "noch kein Körper";
  const names = WHERE_NAMES[body.kind] ?? WHERE_NAMES[0];
  const where = third(body.where, [names[0], `zwischen ${names[0]} und ${names[1]}`, names[1]]);
  const how = ["weich angeschlagen", "hart angeschlagen", "gezupft", "gestrichen", "angeblasen"][body.exciter] ?? "";
  return `${BODY_NAMES[body.kind]}, ${third(body.size, ["klein", "mittelgroß", "groß"])}, ${materialName(body.material)}, ${how}, ${where}`;
}

// ---- the modes ------------------------------------------------------------------

export interface Mode {
  hz: number;
  /** How strongly the mode is set going (signed: where it is struck decides which way it starts). */
  level: number;
  /** Seconds until the mode has died away by 60 dB. */
  t60: number;
}

/** Bessel function of the first kind, by its integral: enough for the skin's first twenty modes. */
export function bessel(order: number, x: number): number {
  const steps = 96;
  let sum = 0;
  for (let index = 0; index <= steps; index += 1) {
    const tau = (index / steps) * Math.PI;
    sum += Math.cos(order * tau - x * Math.sin(tau)) * (index === 0 || index === steps ? 0.5 : 1);
  }
  return sum / steps;
}

/** The modes of a round skin: the order around the rim and the zero of the Bessel function that sets the pitch. */
const SKIN: readonly (readonly [order: number, zero: number])[] = [
  [0, 2.4048], [1, 3.8317], [2, 5.1356], [0, 5.5201], [3, 6.3802], [1, 7.0156], [4, 7.5883], [2, 8.4172], [0, 8.6537], [5, 8.7715],
  [3, 9.761], [6, 9.9361], [1, 10.1735], [4, 11.0647], [7, 11.0864], [2, 11.6198], [0, 11.7915], [8, 12.2251], [5, 12.3386], [3, 13.0152], [1, 13.3237],
];
/** A bar free at both ends (a marimba's, a glockenspiel's). */
const BAR = [1, 2.756, 5.404, 8.933, 13.344, 18.638, 24.812] as const;
/** A bowl of metal and a glass: their rims flex in two, three, four … waves. */
const BOWL = [1, 2.83, 5.42, 8.77, 12.6] as const;
const GLASS = [1, 2.32, 4.25, 6.63, 9.38] as const;

/** How low a body of this kind and size sounds on a ring without notes (Hz of its lowest mode). */
export function drumHz(body: Body): number {
  const [small, big] = ([[430, 46], [660, 55], [2100, 130], [900, 68], [2600, 180]] as const)[body.kind] ?? [430, 46];
  // A tighter skin or string is higher, too.
  const tension = body.kind < 2 ? expo(0.85, 1.25, body.tight) : 1;
  return expo(small, big, body.size) * tension;
}

export interface Shading {
  /** The ring plays notes: then size does not move the pitch, it darkens and lengthens. */
  tuned: boolean;
  /** 0..1 from dark to bright, 0.5 as built (the sound pad, on rings where it means brightness). */
  bright: number;
  /** Stretches every decay (the sound pad's other axis; 1 as built). */
  ring: number;
  /** How hard it is hit: 0 softly, 1 as usual, 2 with an accent. */
  force: number;
}

export const PLAIN: Shading = { tuned: false, bright: 0.5, ring: 1, force: 1 };

/** The modes of `body` when its lowest one sounds at `hz`. */
export function modesOf(body: Body, hz: number, shading: Shading = PLAIN): Mode[] {
  const { kind, size, tight, material, where, exciter } = body;
  const raw: { ratio: number; level: number; offset?: number }[] = [];

  if (kind === 0) {
    // A point on a round skin: every mode counts by how far it moves there.
    const radius = 0.03 + 0.9 * where;
    for (const [order, zero] of SKIN) {
      const ratio = zero / 2.4048;
      raw.push({ ratio, level: bessel(order, zero * radius) / Math.abs(bessel(order + 1, zero)) / ratio ** 0.5 });
    }
  } else if (kind === 1) {
    // A string: whole-number overtones, a little sharp where it is stiff; a mode is silent where the string is struck on its node.
    const place = lerp(0.5, 0.045, where);
    const stiff = expo(0.0009, 0.00004, tight);
    for (let n = 1; n <= 30; n += 1) {
      raw.push({ ratio: (n * Math.sqrt(1 + stiff * n * n)) / Math.sqrt(1 + stiff), level: Math.sin(n * Math.PI * place) / n });
    }
  } else if (kind === 2) {
    // A bar: its even modes rest in the middle, all of them move at the ends.
    const from = 0.475 * where;
    BAR.forEach((ratio, index) => {
      const bend = ((2 * (index + 1) + 1) * Math.PI) / 2;
      raw.push({ ratio, level: (index % 2 === 0 ? Math.cos(bend * from) : Math.sin(bend * from)) / ratio ** 0.3 });
    });
  } else if (kind === 3) {
    // A tube closed at one end: only the odd overtones, each strongest at the closed end.
    const spot = 0.04 + 0.86 * where;
    for (let n = 1; n <= 12; n += 1) {
      const odd = 2 * n - 1;
      raw.push({ ratio: odd * 1.003 ** (n - 1), level: Math.cos((odd * Math.PI * spot) / 2) / odd ** 0.6 });
    }
  } else {
    // A bowl: few modes, far apart, each one twice and a hair apart, so it beats. The rim wakes the high ones.
    const glassy = clamp((material - 0.5) * 2, 0, 1);
    BOWL.forEach((metal, index) => {
      const n = index + 1;
      const ratio = lerp(metal, GLASS[index] ?? metal, glassy);
      const level = n ** lerp(-1.7, 0.15, where);
      const beat = (0.45 + 0.6 * n) * Math.sqrt(hz / 220) * lerp(1.5, 0.5, tight);
      raw.push({ ratio, level: level * 0.74 }, { ratio, level: level * 0.42, offset: beat });
    });
  }

  // What it is made of, how tight and how big it is, and how it is set going shade every mode alike.
  const force = clamp(Math.round(shading.force), 0, 2);
  const dark = along(material, 0.35, -0.05, 0.3)
    + lerp(0.35, -0.3, tight)
    + (shading.tuned ? lerp(-0.15, 0.3, size) : 0)
    + lerp(0.6, -0.5, shading.bright)
    + ([0.2, 0, -0.25][force] ?? 0)
    + ([0, 0, 0.6, 0.4, 1.1][exciter] ?? 0);
  // A mallet stays on the body for a moment: the softer it is, the less it wakes what is higher than that.
  const reach = ([0.6, 1, 1.7][force] ?? 1) * ([Math.max(3.2 * hz, 500), Math.max(18 * hz, 5000), Math.max(10 * hz, 3500), 1e9, 1e9][exciter] ?? 1e9);
  const lasting = along(material, 0.22, 2.4, 3.6)
    * ([0.5, 1.6, 1, 0.45, 2][kind] ?? 1)
    * (220 / hz) ** 0.55
    * expo(0.6, 1.7, size)
    * expo(1.5, 0.55, tight)
    * shading.ring;
  const dying = along(material, 1.3, 0.45, 0.8);

  const modes: Mode[] = [];
  for (const { ratio, level, offset = 0 } of raw) {
    const pitch = hz * ratio + offset;
    if (pitch > 19_000) continue;
    modes.push({
      hz: pitch,
      level: (level * ratio ** -dark) / (1 + (pitch / reach) ** 2),
      t60: clamp(lasting / ratio ** dying, 0.03, 7),
    });
  }
  return modes;
}

// ---- from modes to sound ----------------------------------------------------------

export interface Rendered {
  samples: Float32Array;
  /** For a body that sustains: the stretch (in samples) to go round in while the note lasts; both 0 otherwise. */
  loopStart: number;
  loopEnd: number;
  /** Seconds the sound takes to fall silent once the bow or the breath stops. */
  release: number;
}

/** Noise that is the same every time (mulberry32), so a body always sounds the same. */
function hiss(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2_147_483_648 - 1;
  };
}

const TAU = Math.PI * 2;
/** A mode has died by 60 dB after its `t60`; it is followed a little further, until it is truly gone. */
const SIXTY = 3 * Math.LN10;
const FOLLOW = 1.17;
const LONGEST = 4;

/** Loudness is judged over the beginning of a struck sound and over the steady part of a sustained one. */
function level(samples: Float32Array, from: number, to: number, target: number): void {
  let energy = 0;
  for (let index = from; index < to; index += 1) energy += (samples[index] ?? 0) ** 2;
  const rms = Math.sqrt(energy / Math.max(1, to - from));
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (rms <= 0 || peak <= 0) return;
  const gain = Math.min(target / rms, 0.98 / peak);
  for (let index = 0; index < samples.length; index += 1) samples[index] = (samples[index] ?? 0) * gain;
}

function renderStruck(body: Body, hz: number, sampleRate: number, shading: Shading): Rendered {
  const modes = modesOf(body, hz, shading).filter((mode) => mode.hz < sampleRate * 0.45);
  const longest = modes.reduce((most, mode) => Math.max(most, mode.t60), 0.05);
  const length = Math.ceil(Math.min(LONGEST, longest * FOLLOW + 0.03) * sampleRate);
  const out = new Float64Array(length);
  const force = clamp(Math.round(shading.force), 0, 2);
  // A slack skin is stretched by the blow and sounds higher for a moment: the "bwoom" of a drum.
  const bend = body.kind === 0 ? lerp(0.5, 0.02, body.tight) * ([0.7, 1, 1.25][force] ?? 1) : 0;
  const bendSamples = Math.min(length, Math.ceil(0.22 * sampleRate));

  for (const mode of modes) {
    const fade = Math.exp(-SIXTY / (mode.t60 * sampleRate));
    const until = Math.min(length, Math.ceil(mode.t60 * FOLLOW * sampleRate));
    const turn = (TAU * mode.hz) / sampleRate;
    let cos = Math.cos(turn) * fade;
    let sin = Math.sin(turn) * fade;
    let real = mode.level;
    let imaginary = 0;
    for (let index = 0; index < until; index += 1) {
      if (bend > 0 && index < bendSamples && index % 16 === 0) {
        const now = turn * (1 + bend * Math.exp(-index / (0.03 * sampleRate)));
        cos = Math.cos(now) * fade;
        sin = Math.sin(now) * fade;
      }
      const next = real * cos - imaginary * sin;
      imaginary = real * sin + imaginary * cos;
      real = next;
      out[index] = (out[index] ?? 0) + imaginary;
    }
  }
  let loudest = 0;
  for (const sample of out) loudest = Math.max(loudest, Math.abs(sample));

  // What sets it going is heard, too: the thud of felt, the click of wood, the tick of a nail.
  const noise = hiss(7 + body.kind * 31 + body.exciter * 7);
  const [share, seconds, bright] = ([[0.1, 0.006, 0.12], [0.3, 0.0016, 0.9], [0.14, 0.0008, 0.8]] as const)[body.exciter] ?? [0, 0.001, 0.5];
  const touch = share * ([0.6, 1, 1.4][force] ?? 1) * loudest;
  let low = 0;
  const touchSamples = Math.min(length, Math.ceil(seconds * 7 * sampleRate));
  for (let index = 0; index < touchSamples; index += 1) {
    const white = noise();
    low += (white - low) * 0.12;
    out[index] = (out[index] ?? 0) + touch * Math.exp(-index / (seconds * sampleRate)) * lerp(low * 2.4, white - low, bright);
  }

  const samples = new Float32Array(length);
  // The softer the mallet, the longer it takes to let go.
  const attack = Math.max(2, Math.round(([0.004, 0.0007, 0.0004][body.exciter] ?? 0.001) * sampleRate));
  const tail = Math.min(length, Math.round(0.006 * sampleRate));
  for (let index = 0; index < length; index += 1) {
    let sample = out[index] ?? 0;
    if (index < attack) sample *= 0.5 - 0.5 * Math.cos((Math.PI * index) / attack);
    if (index >= length - tail) sample *= (length - index) / tail;
    samples[index] = sample;
  }
  level(samples, 0, Math.min(length, Math.round(0.35 * sampleRate)), 0.2);
  return { samples, loopStart: 0, loopEnd: 0, release: 0 };
}

/** Seconds before the loop: the bow bites, the breath finds its tone. */
const LEAD = 0.8;
const ROUND = 2;

function renderSustained(body: Body, hz: number, sampleRate: number, shading: Shading): Rendered {
  // The loop holds a whole number of the fundamental's waves, and every other mode is nudged to fit as well.
  const loop = Math.round((Math.round(ROUND * hz) / hz) * sampleRate);
  const grid = sampleRate / loop;
  const lead = Math.round(LEAD * sampleRate);
  const length = lead + loop;
  const modes = modesOf(body, hz, shading).filter((mode) => mode.hz < sampleRate * 0.45);
  const out = new Float64Array(length);
  const blown = body.exciter === 4;
  const rise = (blown ? 0.06 : 0.11) * sampleRate;

  // What rings long comes in slowly and what dies fast is there at once, as on a bowed bowl and a bowed string.
  for (const mode of modes) {
    const pitch = Math.max(grid, Math.round(mode.hz / grid) * grid);
    const turn = (TAU * pitch) / sampleRate;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const slow = rise + Math.min(0.5, mode.t60 * 0.12) * sampleRate;
    // Fully there when the loop begins, so the loop has nothing left to grow.
    const full = 1 - Math.exp(-lead / slow);
    let real = mode.level;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      const next = real * cos - imaginary * sin;
      imaginary = real * sin + imaginary * cos;
      real = next;
      out[index] = (out[index] ?? 0) + imaginary * (index < lead ? (1 - Math.exp(-index / slow)) / full : 1);
    }
  }
  let loudest = 0;
  for (let index = lead; index < length; index += 1) loudest = Math.max(loudest, Math.abs(out[index] ?? 0));

  // Breath and bow hair: noise that is coloured by the body's lowest modes, with a puff at the start of a breath.
  const noise = hiss(91 + body.kind * 13);
  const air = new Float64Array(length);
  const voices = modes.slice(0, blown ? 3 : 2).map((mode) => {
    const turn = (TAU * Math.min(mode.hz, sampleRate * 0.4)) / sampleRate;
    const radius = 1 - (Math.PI * Math.max(30, mode.hz / 14)) / sampleRate;
    return { a: 2 * radius * Math.cos(turn), b: -radius * radius, gain: 1 - radius, one: 0, two: 0 };
  });
  let smooth = 0;
  for (let index = 0; index < length; index += 1) {
    const white = noise();
    smooth += (white - smooth) * (blown ? 0.25 : 0.6);
    let coloured = (blown ? smooth : white - smooth) * 0.25;
    for (const voice of voices) {
      const next = white * voice.gain + voice.a * voice.one + voice.b * voice.two;
      voice.two = voice.one;
      voice.one = next;
      coloured += next * 3;
    }
    const puff = blown ? 1 + 2.2 * Math.exp(-index / (0.035 * sampleRate)) : 1;
    air[index] = coloured * puff * (1 - Math.exp(-index / (rise * 0.5)));
  }
  // The end of the loop fades into what came just before its start, so the noise goes round without a seam.
  const seam = Math.min(lead, Math.round(0.06 * sampleRate));
  for (let index = 0; index < seam; index += 1) {
    const share = index / seam;
    const at = length - seam + index;
    air[at] = (air[at] ?? 0) * Math.sqrt(1 - share) + (air[lead - seam + index] ?? 0) * Math.sqrt(share);
  }
  let airy = 0;
  for (let index = lead; index < length; index += 1) airy = Math.max(airy, Math.abs(air[index] ?? 0));
  const breath = airy > 0 ? ((blown ? lerp(0.42, 0.16, body.tight) : 0.07) * loudest) / airy : 0;

  const samples = new Float32Array(length);
  for (let index = 0; index < length; index += 1) samples[index] = (out[index] ?? 0) + (air[index] ?? 0) * breath;
  level(samples, lead, length, 0.15);
  const lowest = modes[0]?.t60 ?? 0.3;
  return { samples, loopStart: lead, loopEnd: length, release: blown ? 0.05 : clamp(lowest / 6.9, 0.05, 1.2) };
}

/** The sound of `body` with its lowest mode at `hz`: struck once, or sustained in a loop. */
export function renderBody(body: Body, hz: number, sampleRate: number, shading: Shading = PLAIN): Rendered {
  return sustains(body) ? renderSustained(body, hz, sampleRate, shading) : renderStruck(body, hz, sampleRate, shading);
}
