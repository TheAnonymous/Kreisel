/*
 * The time-stretch of the old Akai samplers. Jungle and hard techno are full
 * of voices and breaks that were made longer without getting lower on an S950
 * or an S1000. Those machines did it crudely: the sound is cut into short
 * cycles of one fixed length, and to make it longer some cycles are played
 * again (to make it shorter, some are left out), with a short crossfade at
 * each join. Stretched a lot, every cycle is heard several times in a row,
 * and the sound gets a metallic buzz at the pitch of the cycle: the sample
 * rate divided by the cycle's length. That buzz is wanted. Here a cycle is as
 * long as one wave of the key's root, so the buzz is in key.
 *
 * Everything here is plain arithmetic on a row of numbers: it makes no sound
 * and knows nothing of rings or recordings.
 */

/**
 * The lowest note a cycle buzzes at, in Hz; the highest is just under an
 * octave above it, so every note has exactly one cycle. That makes a cycle 15
 * to 30 ms long. Longer, and the repeats are heard one by one, as a stutter;
 * shorter, and a cycle no longer holds one whole wave of a bass.
 */
const LOWEST = 33;
/** A cycle where none is given: 20 ms at 48 kHz. */
const USUAL = 960;
/** How far a sound can be stretched either way: beyond this there is little left of it. */
const SHORTEST = 0.25;
const LONGEST = 8;

/**
 * The cycle length, in samples, whose buzz is the note `rootHz` (any octave of it): the octave is chosen so that a
 * cycle is between about 15 and 30 ms long (33 to 66 Hz). At 48 kHz and a root of 49 Hz (G1) that is 980 samples.
 * A rate that is none is 48 kHz, a root that is none gives 20 ms.
 */
export function cycleFor(sampleRate: number, rootHz: number): number {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48_000;
  let hz = Number.isFinite(rootHz) && rootHz > 0 ? rootHz : 50;
  // Halving and doubling are exact, so a root on the edge of the octave lands on the same side every time.
  while (hz >= LOWEST * 2) hz /= 2;
  while (hz < LOWEST) hz *= 2;
  return Math.max(1, Math.round(rate / hz));
}

/**
 * `samples` made `factor` times as long (0.25..8; 1 returns a copy) at the same pitch, by repeating or leaving out
 * cycles of `cycle` samples. The output is `Math.round(samples.length * factor)` samples long. Neighbouring pieces
 * are joined with a short crossfade (a sixteenth of a cycle, at least 8 samples) so that nothing clicks. Empty
 * input gives empty output; a cycle longer than the sound is shortened to it. A factor that is no number is 1, a
 * cycle that is none is 20 ms at 48 kHz.
 */
export function stretch(samples: Float32Array, factor: number, cycle: number): Float32Array<ArrayBuffer> {
  const length = samples.length;
  const by = Number.isFinite(factor) ? Math.min(LONGEST, Math.max(SHORTEST, factor)) : 1;
  const out = new Float32Array(Math.round(length * by));
  const size = Math.min(length, Number.isFinite(cycle) && cycle >= 1 ? Math.round(cycle) : USUAL);
  const fade = Math.min(size, Math.max(8, Math.round(size / 16)));
  // Where the piece before this one would read on, were it not over: a join fades from there into the new piece.
  let on = 0;
  for (let piece = 0, at = 0; at < out.length; piece += 1, at += size) {
    const span = Math.min(size, out.length - at);
    // The output runs `by` times as slowly through the cycles as it runs through its own pieces. Rounded down, that
    // spreads the repeats (or the gaps) evenly: at 1.5 the cycles come as 0 0 1 2 2 3 4 4. A piece that would run
    // past the end of the sound is moved back until it ends with it: there is nothing after a sound to repeat, and
    // a piece filled up with silence would tear a hole into every repeat of the last cycle.
    const from = Math.min(Math.floor(piece / by) * size, length - span);
    const joined = Math.min(fade, span);
    for (let index = 0; index < joined; index += 1) {
      const old = samples[Math.min(on + index, length - 1)] ?? 0;
      const fresh = samples[from + index] ?? 0;
      // Written as the old plus a share of the difference, a piece that simply follows on from the one before it
      // (every piece, at a factor of 1) comes out exactly as it went in.
      out[at + index] = old + ((fresh - old) * (index + 1)) / (fade + 1);
    }
    for (let index = joined; index < span; index += 1) out[at + index] = samples[from + index] ?? 0;
    on = from + size;
  }
  return out;
}
