import type { StyleId } from "./model";
import { placeOf } from "./sounds/index";

/*
 * The hi-hat as a drum machine has it: the open and the closed hat are one
 * voice, so a closed hit cuts off the open one that still rings. A techno
 * Kreisel's hi-hat ring is such a machine. In every other Kreisel each hit
 * rings out, as it always did, so that no older Kreisel sounds different.
 *
 * Open and closed are what they were: a hit moved outwards on the ring is an
 * open one. Nothing new is stored.
 */

/** The hi-hat's ring. */
export const HAT_TRACK = 2;

/**
 * How far out the open hits of the techno Kreisel and of the techno dice
 * stand. A hit's place outwards stretches how long it rings; this far out, a
 * hat that is a tick when closed rings through the sixteenth after it (at the
 * pad's middle it is 20 dB down after an eighth of a second, about four times
 * later than at the three steps out it stood at before). That is what there is
 * for a closed hit to cut off.
 */
export const OPEN_HAT = 6;

/** A hit moved outwards on the hi-hat's ring is an open one. */
export const isOpenHat = (pitch: number): boolean => pitch > 0;

/** Whether the hi-hat of a Kreisel of this style is one voice: a closed hit cuts off the open ones before it. */
export const hatChokes = (style: StyleId): boolean => style === "techno";

/**
 * The cymbals, the fifth family of the hi-hat's palette (ride, crash and
 * their kin): they ring by themselves, so they keep time rather than open
 * and close.
 */
export const isCymbal = (sound: number): boolean => placeOf(sound)?.family === 4;

/** The time constant with which a hat that is cut off falls silent, in seconds: at once to the ear, and without a click. */
export const CHOKE_SECONDS = 0.004;

/** How many open hits can ring at once before the oldest is left to itself: more than a roll of four. */
export const OPEN_HATS = 6;
