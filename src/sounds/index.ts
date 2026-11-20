import { BASS } from "./bass";
import { CHORD } from "./chord";
import { HAT } from "./hat";
import { KICK } from "./kick";
import { LEAD } from "./lead";
import { PERC } from "./perc";
import type { Drum, Palette, Listed, Tone } from "./shapes";
import { SNARE } from "./snare";
import { TRIMS } from "./trims";

/*
 * The palettes: fifty ready-made sounds for every ring, in five families of
 * ten. A ring's four classics lead the first four families and keep the
 * numbers they always had (0 to 3), so a Kreisel from an old link sounds as
 * it did. The numbers 4 to 6 are the ring's own sounds (painted, built,
 * sung); everything else on the palette follows from 7 on, family by family.
 *
 * A sound's number is its place on the palette and travels in links and saved
 * Kreisels: a sound may be changed or renamed where it stands, but never
 * moved, and a palette never grows in the middle.
 */

export const FAMILY_COUNT = 5;
export const FAMILY_SIZE = 10;
/** How many ready-made sounds a ring has. */
export const SOUND_COUNT = FAMILY_COUNT * FAMILY_SIZE;

const CLASSICS = 4;
/** The first number after the ring's own sounds. */
const FIRST_NEW = 7;

/** Where a ready-made sound stands: which family, and which place in it. */
export interface Place {
  family: number;
  place: number;
}

/** The number of the sound at a place on the palette. */
export function soundAt(family: number, place: number): number {
  if (family < CLASSICS) return place === 0 ? family : FIRST_NEW + family * (FAMILY_SIZE - 1) + place - 1;
  return FIRST_NEW + CLASSICS * (FAMILY_SIZE - 1) + place;
}

/** Where a sound stands on the palette; `null` for a ring's own sounds and for numbers that are none. */
export function placeOf(sound: number): Place | null {
  if (!Number.isInteger(sound) || sound < 0) return null;
  if (sound < CLASSICS) return { family: sound, place: 0 };
  const index = sound - FIRST_NEW;
  if (index < 0) return null;
  const led = CLASSICS * (FAMILY_SIZE - 1);
  if (index < led) return { family: Math.floor(index / (FAMILY_SIZE - 1)), place: (index % (FAMILY_SIZE - 1)) + 1 };
  return index - led < FAMILY_SIZE ? { family: CLASSICS, place: index - led } : null;
}

/** The highest number a sound can have. Every whole number from 0 up to it is a sound: a classic, one of the ring's own, or one from the palette. */
export const LAST_SOUND = soundAt(FAMILY_COUNT - 1, FAMILY_SIZE - 1);

/** Every ready-made sound's number, in the order of the palette. */
export const PALETTE_ORDER: readonly number[] = Array.from({ length: SOUND_COUNT }, (_, index) => soundAt(Math.floor(index / FAMILY_SIZE), index % FAMILY_SIZE));

/** The sound `by` places further along the palette, round and round. From one of the ring's own sounds it is the first on the palette, or the last. */
export function alongPalette(sound: number, by: number): number {
  const at = PALETTE_ORDER.indexOf(sound);
  if (at < 0) return PALETTE_ORDER[by < 0 ? SOUND_COUNT - 1 : 0] ?? 0;
  return PALETTE_ORDER[(((at + by) % SOUND_COUNT) + SOUND_COUNT) % SOUND_COUNT] ?? 0;
}

const DRUMS: readonly Palette<Drum>[] = [KICK, SNARE, HAT, PERC];
const TONES: readonly Palette<Tone>[] = [BASS, CHORD, LEAD];

const paletteOf = (track: number): Palette<Drum> | Palette<Tone> | undefined => (track < DRUMS.length ? DRUMS[track] : TONES[track - DRUMS.length]);

function listed<Recipe>(palette: Palette<Recipe> | undefined, sound: number): Listed<Recipe> | null {
  const where = placeOf(sound);
  return (where && palette?.[where.family]?.sounds[where.place]) ?? null;
}

/** What a ready-made sound of this ring is called; `null` for the ring's own sounds. */
export function soundName(track: number, sound: number): string | null {
  return listed<Drum | Tone>(paletteOf(track), sound)?.name ?? null;
}

/** The names of a ring's five families. */
export function familyNames(track: number): string[] {
  return (paletteOf(track) ?? []).map((family) => family.name);
}

/** The ten sounds of one family of a ring: what each is called and its number. */
export function familySounds(track: number, family: number): { name: string; sound: number }[] {
  return (paletteOf(track)?.[family]?.sounds ?? []).map((one, place) => ({ name: one.name, sound: soundAt(family, place) }));
}

function recipe<Recipe extends object>(palette: Palette<Recipe> | undefined, sound: number): Recipe | null {
  const one = listed(palette, sound);
  return one && !("classic" in one) ? one : null;
}

/** How a drum ring's sound is made; `null` for the classics, which are played as ever, and for the ring's own sounds. */
export const drumOf = (track: number, sound: number): Drum | null => recipe(DRUMS[track], sound);

/** How a sound of a ring that plays notes is made; `null` for the classics and for the ring's own sounds. */
export const toneOf = (track: number, sound: number): Tone | null => recipe(TONES[track - DRUMS.length], sound);

/** By how much a sound is turned up or down so that the palette is evenly loud (see trims.ts). */
export function trimOf(track: number, sound: number): number {
  const at = PALETTE_ORDER.indexOf(sound);
  return (at < 0 ? undefined : TRIMS[track]?.[at]) ?? 1;
}

export type { Drum, Part, Tone } from "./shapes";
