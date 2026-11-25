import { soundOf, type Ready } from "../audio/sample";
import { peaks } from "../sample-analysis";

/*
 * A recording for the eye: how loud it is, part by part. The wheel draws it
 * around a ring, the sampler's panel along a strip, the ring's row as a
 * thumb. Looking at a recording costs time, so what was looked at is kept.
 */

const mono = new WeakMap<Ready, Float32Array>();
const kept = new Map<string, Float32Array>();
const MOST = 80;

/** The recording as one line of numbers (both channels as one). */
export function line(made: Ready): Float32Array {
  let samples = mono.get(made);
  if (!samples) {
    samples = soundOf(made);
    mono.set(made, samples);
  }
  return samples;
}

/**
 * How loud each of `buckets` equal parts of a recording is, between the shares `from` and `to` of it (0..1): the
 * highest sample of each part, 0..1. `id` is the recording's name (what was looked at once is kept under it).
 */
export function loudness(id: string, made: Ready, buckets: number, from = 0, to = 1): Float32Array {
  const key = `${id}|${buckets}|${from.toFixed(4)}|${to.toFixed(4)}`;
  const found = kept.get(key);
  if (found) return found;
  const samples = line(made);
  const pairs = peaks(samples, buckets, Math.round(from * samples.length), Math.round(to * samples.length));
  const loud = new Float32Array(buckets);
  for (let bucket = 0; bucket < buckets; bucket += 1) loud[bucket] = Math.min(1, Math.max(Math.abs(pairs[bucket * 2] ?? 0), Math.abs(pairs[bucket * 2 + 1] ?? 0)));
  if (kept.size >= MOST) kept.clear();
  kept.set(key, loud);
  return loud;
}
