import type { Project } from "../model";
import { MONO_BELOW } from "../press";
import { renderBuffer } from "./engine";

/*
 * The whole Kreisel, rendered faster than it plays, and what can be measured
 * on it. For the tests of what works on everything at once (how hard the
 * rings are driven, how hard the sum is pressed), and for setting such things
 * by measurement where nobody is there to listen.
 */

export interface Whole {
  /** The highest sample of either channel. */
  peak: number;
  /** How loud it is over all of its length, as a root mean square. */
  loud: number;
  /** How far its peak stands above that, in dB: the less, the denser it is. */
  crest: number;
  /** How bright it is: the Hz that as many zero crossings would make in a pure tone. */
  bright: number;
  /** How much of its deep lows differs between left and right, against what they share: 0 when the lows are in the middle. */
  lowSide: number;
}

/** What is left of `samples` below about `hz`: four soft filters in a row, enough for a measurement. */
function lows(samples: Float32Array, hz: number, sampleRate: number): Float32Array {
  const share = 1 - Math.exp((-2 * Math.PI * hz) / sampleRate);
  const result = Float32Array.from(samples);
  for (let pass = 0; pass < 4; pass += 1) {
    let held = 0;
    for (let index = 0; index < result.length; index += 1) {
      held += share * ((result[index] ?? 0) - held);
      result[index] = held;
    }
  }
  return result;
}

const rms = (samples: Float32Array): number => {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return samples.length === 0 ? 0 : Math.sqrt(sum / samples.length);
};

export function measureWhole(left: Float32Array, right: Float32Array, sampleRate: number): Whole {
  const middle = new Float32Array(left.length);
  const side = new Float32Array(left.length);
  let peak = 0;
  let crossings = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    middle[index] = (l + r) / 2;
    side[index] = (l - r) / 2;
    if (index > 0 && (middle[index] ?? 0) >= 0 !== (middle[index - 1] ?? 0) >= 0) crossings += 1;
  }
  const loud = Math.sqrt((rms(left) ** 2 + rms(right) ** 2) / 2);
  // Well below where the press brings the lows together, so that what is measured is its doing and not the slope of its filters.
  const deep = MONO_BELOW / 2;
  const shared = rms(lows(middle, deep, sampleRate));
  return {
    peak,
    loud,
    crest: loud > 0 ? 20 * Math.log10(peak / loud) : 0,
    bright: left.length === 0 ? 0 : (crossings / 2) * (sampleRate / left.length),
    lowSide: shared > 0 ? rms(lows(side, deep, sampleRate)) / shared : 0,
  };
}

/** Renders the project as a saved file would hold it (the scene twice through its chords, the chain, or the piece) and measures it. */
export async function hearWhole(project: Project): Promise<Whole> {
  const { buffer, length } = await renderBuffer(project);
  return measureWhole(buffer.getChannelData(0).subarray(0, length), buffer.getChannelData(1).subarray(0, length), buffer.sampleRate);
}
