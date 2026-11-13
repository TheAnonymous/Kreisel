import { hzToHeight, makeStroke, snapHeight, type RawPoint } from "./bild";
import { HEIGHT_MAX, trackInfo, type Bild, type Stroke } from "./model";

/*
 * "Vormachen": a sound made into the microphone becomes a picture. The
 * listening side hands in what it heard as frames, a few dozen a second, each
 * with a loudness, a pitch where there was a clear tone, and where the hiss
 * sat when there was none. Runs of tone become humming strokes, runs of hiss
 * become hissing ones. It is an impression, not a recording: a "bumm" turns
 * into a falling stroke that can then be repainted like any other.
 */

export interface Frame {
  /** Seconds since listening began. */
  time: number;
  /** Loudness (RMS), 0..1. */
  level: number;
  /** Hz of a clear tone, or `null` when there was none. */
  pitch: number | null;
  /** Hz around which the sound's noise sits (from how often the wave crosses zero). */
  bright: number;
}

/**
 * One window of sound as a frame's worth of facts. The pitch is found with a
 * normalized autocorrelation (as in McLeod's pitch method) on every second
 * sample: voices and whistles up to about 1 kHz, down to about 60 Hz.
 */
export function analyse(samples: Float32Array, sampleRate: number): Omit<Frame, "time"> {
  const count = samples.length >> 1;
  const half = new Float32Array(count);
  let energy = 0;
  let crossings = 0;
  let before = 0;
  for (let index = 0; index < count; index += 1) {
    const value = ((samples[index * 2] ?? 0) + (samples[index * 2 + 1] ?? 0)) / 2;
    half[index] = value;
    energy += value * value;
    if ((value >= 0) !== (before >= 0)) crossings += 1;
    before = value;
  }
  const rate = sampleRate / 2;
  const level = Math.sqrt(energy / Math.max(1, count));
  const bright = (crossings * rate) / (2 * Math.max(1, count));
  if (level < 0.004) return { level, pitch: null, bright };

  const shortest = Math.max(2, Math.floor(rate / 1000));
  const longest = Math.min(count >> 1, Math.floor(rate / 60));
  const clarity = new Float32Array(longest + 1);
  let best = 0;
  for (let lag = shortest; lag <= longest; lag += 1) {
    let match = 0;
    let power = 0;
    for (let index = 0; index + lag < count; index += 1) {
      const a = half[index] ?? 0;
      const b = half[index + lag] ?? 0;
      match += a * b;
      power += a * a + b * b;
    }
    clarity[lag] = power > 0 ? (2 * match) / power : 0;
    best = Math.max(best, clarity[lag] ?? 0);
  }
  if (best < 0.82) return { level, pitch: null, bright };
  // The first peak nearly as high as the best one: the tone itself, not one of its lower octaves.
  let past = false;
  for (let lag = shortest + 1; lag < longest; lag += 1) {
    const here = clarity[lag] ?? 0;
    if (here < 0) past = true;
    if (!past && lag > shortest + 2 && here < (clarity[lag - 1] ?? 0)) past = true;
    if (past && here >= best * 0.93 && here >= (clarity[lag - 1] ?? 0) && here >= (clarity[lag + 1] ?? 0)) {
      const left = clarity[lag - 1] ?? 0;
      const right = clarity[lag + 1] ?? 0;
      const bend = left - 2 * here + right;
      const exact = lag + (bend === 0 ? 0 : (0.5 * (left - right)) / bend);
      return { level, pitch: rate / exact, bright };
    }
  }
  return { level, pitch: null, bright };
}

interface Run {
  tone: boolean;
  frames: Frame[];
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
};

/** How long a picture is at the middle of the sound pad: the time the frames are laid out on. */
const PICTURE_SECONDS = 1;
const MAX_IMITATED = 6;

/** The picture of what was heard, laid out for ring `track`; `null` if there was nothing to hear. */
export function framesToBild(frames: readonly Frame[], track: number): Bild | null {
  const loudest = frames.reduce((peak, frame) => Math.max(peak, frame.level), 0);
  const threshold = Math.max(0.012, loudest * 0.14);
  const start = frames.findIndex((frame) => frame.level >= threshold);
  if (start < 0) return null;
  let end = start;
  frames.forEach((frame, index) => {
    if (frame.level >= threshold * 0.6) end = index;
  });
  const heard = frames.slice(start, end + 1);
  const began = heard[0]?.time ?? 0;
  const lasted = Math.max(0.03, (heard[heard.length - 1]?.time ?? began) - began);
  const scale = 1 / Math.max(PICTURE_SECONDS, lasted);

  // Runs of tone and runs of hiss; a single stray frame does not break a run.
  const runs: Run[] = [];
  heard.forEach((frame, index) => {
    if (frame.level < threshold * 0.6) return;
    const neighbours = [heard[index - 1], heard[index + 1]].filter((other): other is Frame => other !== undefined);
    const tone = frame.pitch !== null || (neighbours.length === 2 && neighbours.every((other) => other.pitch !== null));
    const run = runs[runs.length - 1];
    const last = run?.frames[run.frames.length - 1];
    if (run && run.tone === tone && last && frame.time - last.time < 0.09) run.frames.push(frame);
    else runs.push({ tone, frames: [frame] });
  });
  const peakOf = (run: Run): number => run.frames.reduce((peak, frame) => Math.max(peak, frame.level), 0);
  const kept = [...runs].sort((a, b) => peakOf(b) - peakOf(a)).slice(0, MAX_IMITATED);

  // Where the picture's main tone should sit: on the root for rings that play notes, low for a kick.
  const info = trackInfo(track);
  const main = kept.find((run) => run.tone);
  const mainPitches = main?.frames.map((frame) => frame.pitch).filter((pitch): pitch is number => pitch !== null) ?? [];
  let shift = 0;
  if (mainPitches.length > 0) {
    if (info.refHz > 0) shift = hzToHeight(info.refHz * (track === 3 ? 2 : 1)) - hzToHeight(median(mainPitches));
    else if (track === 0) shift = hzToHeight(52) - hzToHeight(Math.min(...mainPitches));
  }

  const strokes: Stroke[] = [];
  for (const run of runs) {
    if (!kept.includes(run)) continue;
    const peak = peakOf(run);
    const points: RawPoint[] = run.frames.map((frame, index) => {
      const near = [run.frames[index - 1], frame, run.frames[index + 1]].filter((other): other is Frame => other !== undefined);
      const pitches = near.map((other) => other.pitch).filter((pitch): pitch is number => pitch !== null);
      const hz = run.tone ? (pitches.length > 0 ? median(pitches) : (frame.pitch ?? 200)) : Math.max(250, Math.min(12_000, median(near.map((other) => other.bright))));
      const height = hzToHeight(hz) + (run.tone ? shift : 0);
      return { t: (frame.time - began) * scale, y: Math.max(0, Math.min(1, height / HEIGHT_MAX)) };
    });
    const kind = run.tone ? 0 : 2;
    const size = peak > loudest * 0.6 ? 2 : peak > loudest * 0.3 ? 1 : 0;
    const stroke = makeStroke(kind, size, points, (y) => snapHeight(track, kind, y));
    if (!stroke) continue;
    // Loudest towards its end and long enough to tell: it swelled.
    const loudestAt = run.frames.findIndex((frame) => frame.level === peak);
    const length = (run.frames[run.frames.length - 1]?.time ?? 0) - (run.frames[0]?.time ?? 0);
    stroke.swell = length > 0.18 && loudestAt > run.frames.length * 0.66;
    strokes.push(stroke);
  }
  return strokes.length > 0 ? { strokes, hold: null } : null;
}
