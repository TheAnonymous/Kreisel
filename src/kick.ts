import { wrap } from "./model";

/*
 * The kick's place in the key. A kick has a pitch: the tone its body lands
 * on after the fall. So that it does not rub against the bass and against
 * its own Nachbeben, it lands on the key's root or on its fifth, whichever
 * is nearer to where the sound and the pad put it.
 */

/** How far apart the root and the fifth are at most from any pitch, in semitones: half the wider of the two gaps between them. */
export const KICK_REACH = 3.5;

/** The pitch a kick lands on: the root or the fifth of the key (`root`: 0 = C … 11 = H) nearest to `hz`. */
export function kickHz(hz: number, root: number): number {
  if (!(hz > 0) || !Number.isFinite(hz)) return hz;
  const midi = 69 + 12 * Math.log2(hz / 440);
  let nearest = Infinity;
  for (const name of [root, root + 7]) {
    // The note of this name nearest to where the kick is.
    const away = wrap(name - midi + 6, 12) - 6;
    if (Math.abs(away) < Math.abs(nearest)) nearest = away;
  }
  return hz * 2 ** (nearest / 12);
}
