/*
 * Hardness, as plain arithmetic. "Zerre" drives one ring into a shaper, the
 * same one the sparks of the weather use. "Druck" presses the sum of
 * everything against a ceiling in two stages before the master hears it, the
 * way a loud techno master is made: by clipping softly, twice, not by turning
 * it up. Both are nothing at zero: a Kreisel without them sounds as it always
 * did.
 */

const expo = (from: number, to: number, share: number): number => from * (to / from) ** share;
const share01 = (value: number): number => Math.min(1, Math.max(0, value));

// ---- Zerre: one ring ---------------------------------------------------------------

/** How much of a ring goes through its shaper: its own Zerre and the sparks lying on it add up. */
export const driven = (drive: number, sparks: number): number => Math.min(1, share01(drive) + share01(sparks));

/**
 * The gains around a ring's shaper for an amount of 0..1. More of the sound
 * goes through the shaper, and harder; what comes out is evened against what
 * went in.
 */
export function driveGains(amount: number): { dry: number; push: number; wet: number } {
  const much = share01(amount);
  return { dry: 1 - much * 0.9, push: expo(1.2, 5, much), wet: much * 0.27 };
}

/**
 * What a ring's own Zerre is turned up or down by, in dB, so that the control
 * changes how the ring sounds more than how loud it is. Left alone, a ring
 * gets quieter up to the middle of the control and louder at its end
 * (measured on rings of the techno Kreisel, each by itself: 2 dB down and
 * 3 dB up in Chromium). How much depends on the browser, because each delays
 * the driven share of the sound a little differently against the clean one:
 * in Firefox the rings that play notes hardly get quieter at all. So this
 * lies between the two: with it a ring stays within about 1.5 dB of its clean
 * loudness up to the middle in Chromium and gets up to 3 dB louder there in
 * Firefox, and in both it is 1 to 3 dB louder at the end. Its peaks stay
 * close to the clean ring's.
 */
const TRIM: readonly (readonly [drive: number, dB: number])[] = [[0, 0], [0.15, 0.8], [0.3, 1.5], [0.45, 2.2], [0.6, 1.6], [0.75, 0.8], [0.9, -0.3], [1, -1.4]];

export function driveTrim(drive: number): number {
  const much = share01(drive);
  const after = TRIM.findIndex(([at]) => at >= much);
  const [highAt, high] = TRIM[Math.max(1, after)] ?? [1, 0];
  const [lowAt, low] = TRIM[Math.max(1, after) - 1] ?? [0, 0];
  return 10 ** ((low + ((high - low) * (much - lowAt)) / (highAt - lowAt)) / 20);
}

/**
 * The gains around a ring's shaper for its own Zerre and the sparks that lie
 * on it right now. Without Zerre these are the sparks' own numbers, as ever.
 */
export function ringGains(drive: number, sparks: number): { dry: number; push: number; wet: number } {
  const gains = driveGains(driven(drive, sparks));
  const trim = driveTrim(drive);
  return { dry: gains.dry * trim, push: gains.push, wet: gains.wet * trim };
}

// ---- Druck: the sum ----------------------------------------------------------------

/** The first stage is soft: it starts to round off early and never passes 1. */
export const FIRST = { knee: 0.4, top: 1, reach: 8 } as const;
/** The second is harder: it leaves more alone and stops a little under full scale. */
export const SECOND = { knee: 0.7, top: 0.95, reach: 2 } as const;
/** Below this everything is brought to the middle while the press works. */
export const MONO_BELOW = 150;

/** A clipper with a soft knee: untouched up to `knee`, then rounding off towards `top`, which it never passes. */
export function clip(value: number, knee: number, top: number): number {
  const size = Math.abs(value);
  if (size <= knee) return value;
  return Math.sign(value) * (knee + (top - knee) * Math.tanh((size - knee) / (top - knee)));
}

/** `clip` as the curve of a shaper whose input runs from −reach to reach. */
export function clipCurve(stage: { knee: number; top: number; reach: number }, points = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(points);
  const middle = (points - 1) / 2;
  for (let index = 0; index < points; index += 1) curve[index] = clip(((index - middle) / middle) * stage.reach, stage.knee, stage.top);
  return curve;
}

export interface PressGains {
  /** What passes beside the two clippers: all of it at rest, none of it once the press has taken hold. */
  clean: number;
  pressed: number;
  /** How hard the sum is pushed into the first clipper, and what leaves it into the second. */
  first: number;
  second: number;
  /** Whether the lows are brought to the middle. */
  mono: boolean;
}

/**
 * The press at an amount of 0..1. The first few hundredths fade the clippers
 * in (what is quiet passes them untouched, so nothing jumps); from there on
 * the sum is pushed harder and harder into them, up to four times into the
 * first and twice into the second.
 */
export function pressGains(amount: number): PressGains {
  const much = share01(amount);
  const taken = Math.min(1, much / 0.06);
  return { clean: 1 - taken, pressed: taken, first: expo(1, 4, much), second: expo(1, 2, much), mono: much > 0 };
}
