import type { Project } from "../model";
import { MONO_BELOW } from "../press";
import { RENDER_LEAD, renderBuffer } from "./engine";

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
  /**
   * How sharp it is: the Hz of a pure tone that changes as fast from sample to sample as this does on average. Unlike the
   * zero crossings it rises with every overtone a filter lets through, also where the wave keeps crossing zero at its own pace.
   */
  sharp: number;
  /** How much of its deep lows differs between left and right, against what they share: 0 when the lows are in the middle. */
  lowSide: number;
  /** How much of it lies deep down (below about 75 Hz), against all of it: 0..1. */
  deep: number;
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
  const steps = new Float32Array(Math.max(0, middle.length - 1));
  for (let index = 0; index < steps.length; index += 1) steps[index] = (middle[index + 1] ?? 0) - (middle[index] ?? 0);
  const even = rms(middle);
  // Well below where the press brings the lows together, so that what is measured is its doing and not the slope of its filters.
  const deep = MONO_BELOW / 2;
  const shared = rms(lows(middle, deep, sampleRate));
  return {
    peak,
    loud,
    crest: loud > 0 ? 20 * Math.log10(peak / loud) : 0,
    bright: left.length === 0 ? 0 : (crossings / 2) * (sampleRate / left.length),
    sharp: even > 0 ? (sampleRate / (2 * Math.PI)) * (rms(steps) / even) : 0,
    lowSide: shared > 0 ? rms(lows(side, deep, sampleRate)) / shared : 0,
    deep: loud > 0 ? Math.min(1, shared / loud) : 0,
  };
}

/** One beat of a render: how loud it is, and how much of that lies deep down and high up. */
export interface Beat {
  /** How loud the beat is, as a root mean square of both channels. */
  loud: number;
  /** How loud what lies deep down in it is (below about 75 Hz), measured the same way. */
  deep: number;
  /** How loud what lies high up in it is (above about 4 kHz). */
  high: number;
  /** How loud what lies below about 1 kHz is: the body of drums, bass and chords, without a crash or a riser's hiss. */
  body: number;
}

/** What is left of `samples` above about `hz`: the samples less their lows. */
function highs(samples: Float32Array, hz: number, sampleRate: number): Float32Array {
  const low = lows(samples, hz, sampleRate);
  return samples.map((sample, index) => sample - (low[index] ?? 0));
}

/**
 * A render beat by beat (a beat is `beatSeconds` long), for what happens over time: a build-up thins the lows out
 * and lets the level sink, the gap before a drop is silent, and the drop brings both back.
 */
export function measureBeats(left: Float32Array, right: Float32Array, sampleRate: number, beatSeconds: number): Beat[] {
  const middle = left.map((sample, index) => (sample + (right[index] ?? 0)) / 2);
  const deep = lows(middle, MONO_BELOW / 2, sampleRate);
  const high = highs(middle, 4000, sampleRate);
  const body = lows(middle, 1000, sampleRate);
  const size = beatSeconds * sampleRate;
  const beats: Beat[] = [];
  for (let beat = 0; Math.round((beat + 1) * size) <= left.length; beat += 1) {
    const from = Math.round(beat * size);
    const to = Math.round((beat + 1) * size);
    beats.push({
      loud: Math.sqrt((rms(left.subarray(from, to)) ** 2 + rms(right.subarray(from, to)) ** 2) / 2),
      deep: rms(deep.subarray(from, to)),
      high: rms(high.subarray(from, to)),
      body: rms(body.subarray(from, to)),
    });
  }
  return beats;
}

/** Renders the project as `hearWhole` does and measures it beat by beat, or in `parts` equal parts of a beat (4 for sixteenths). */
export async function hearBeats(project: Project, parts = 1): Promise<Beat[]> {
  const { buffer, length } = await renderBuffer(project);
  // The first beat begins where the render's first step does.
  const from = Math.round(RENDER_LEAD * buffer.sampleRate);
  return measureBeats(buffer.getChannelData(0).subarray(from, length), buffer.getChannelData(1).subarray(from, length), buffer.sampleRate, 60 / project.bpm / Math.max(1, Math.round(parts)));
}

/** Renders the project as a saved file would hold it (the scene twice through its chords, the chain, or the piece) and measures it. */
export async function hearWhole(project: Project): Promise<Whole> {
  const { buffer, length } = await renderBuffer(project);
  return measureWhole(buffer.getChannelData(0).subarray(0, length), buffer.getChannelData(1).subarray(0, length), buffer.sampleRate);
}
