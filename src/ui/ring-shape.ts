/*
 * What the wheel's view (ring.ts) and the hands on it (ring-gestures.ts)
 * both go by: the places a pointer can be on, and a little arithmetic.
 */

/** A place on the wheel that a pointer can be on. */
export type Spot =
  | { kind: "hub" }
  | { kind: "chord"; index: number }
  | { kind: "ring"; track: number; step: number }
  /** The piece's ring: the bar, how high in its band (0..1), and whether on the strip of scenes at its inner edge. */
  | { kind: "piece"; bar: number; height: number; lane: boolean };

/** A full turn. */
export const TAU = Math.PI * 2;
/** How far the weather brush reaches, in pixels, at its three widths. */
export const BRUSH = [9, 18, 32] as const;
export const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;
