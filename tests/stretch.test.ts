import { describe, expect, it } from "vitest";
import { cycleFor, stretch } from "../src/stretch";

const RATE = 48_000;
/** The cycle of G1 at 48 kHz, and the crossfade that goes with it. */
const CYCLE = 980;
const FADE = 61;

/** White noise between −1 and 1, the same every time. */
function noise(length: number, seed = 1): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    out[index] = (((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 32) * 2 - 1;
  }
  return out;
}

const sine = (length: number, hz: number): Float32Array<ArrayBuffer> => Float32Array.from({ length }, (_, index) => Math.sin((2 * Math.PI * hz * index) / RATE));

/** A sound that says where it is: every sample is the number of the cycle it lies in. */
const numbered = (cycles: number, cycle: number): Float32Array<ArrayBuffer> => Float32Array.from({ length: cycles * cycle }, (_, index) => Math.floor(index / cycle));

/** The cycle each piece of a stretched `numbered` sound was taken from, read in the middle of the piece. */
const taken = (out: Float32Array, cycle: number): number[] => Array.from({ length: Math.floor(out.length / cycle) }, (_, piece) => out[piece * cycle + cycle / 2]!);

const rms = (signal: Float32Array): number => Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length);

/** How alike a signal is to itself `lag` samples later: 1 for one that repeats exactly, about 0 for noise. */
function alike(signal: Float32Array, lag: number): number {
  let both = 0;
  let own = 0;
  for (let index = 0; index + lag < signal.length; index += 1) {
    both += signal[index]! * signal[index + lag]!;
    own += signal[index]! ** 2;
  }
  return both / own;
}

/** The largest step from one sample to the next. */
function jump(signal: Float32Array): number {
  let most = 0;
  for (let index = 1; index < signal.length; index += 1) most = Math.max(most, Math.abs(signal[index]! - signal[index - 1]!));
  return most;
}

/**
 * How much of a signal lies around `hz`: the power in one bin, taken over windows of 20 ms and averaged. The windows
 * are short on purpose. A stretched tone starts its wave anew with every repeat, so over a whole second its repeats
 * can cancel in the one bin of its own pitch although every stretch of it still sounds at that pitch.
 */
function power(signal: Float32Array, hz: number): number {
  const size = 960;
  const window = (index: number): number => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
  const cos = Float64Array.from({ length: size }, (_, index) => window(index) * Math.cos((2 * Math.PI * hz * index) / RATE));
  const sin = Float64Array.from({ length: size }, (_, index) => window(index) * Math.sin((2 * Math.PI * hz * index) / RATE));
  let sum = 0;
  let windows = 0;
  for (let at = 0; at + size <= signal.length; at += size / 2) {
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < size; index += 1) {
      real += signal[at + index]! * cos[index]!;
      imaginary += signal[at + index]! * sin[index]!;
    }
    sum += real * real + imaginary * imaginary;
    windows += 1;
  }
  return sum / windows;
}

/** How often a second a signal changes its sign: twice its pitch, for a plain tone. */
function crossings(signal: Float32Array): number {
  let count = 0;
  for (let index = 1; index < signal.length; index += 1) if (signal[index]! >= 0 !== signal[index - 1]! >= 0) count += 1;
  return (count * RATE) / signal.length;
}

const dB = (ratio: number): number => 10 * Math.log10(ratio);

describe("A cycle", () => {
  it("is one wave of the key's root, in the octave where it lasts 15 to 30 ms", () => {
    expect(cycleFor(48_000, 49)).toBe(980);
    expect(cycleFor(48_000, 98)).toBe(980);
    expect(cycleFor(48_000, 24.5)).toBe(980);
    expect(cycleFor(44_100, 55)).toBe(802);
    // The edges of the octave: 33 Hz is the lowest buzz there is, 66 Hz is 33 Hz again.
    expect(cycleFor(48_000, 33)).toBe(1455);
    expect(cycleFor(48_000, 66)).toBe(1455);
    expect(cycleFor(48_000, 65.99)).toBe(727);
  });

  it("buzzes at some octave of its root, between 33 and 66 Hz, whatever the root", () => {
    const notes = Array.from({ length: 80 }, (_, index) => 440 * 2 ** ((index + 16 - 69) / 12));
    const roots = [...Array.from({ length: 1981 }, (_, index) => 20 + index), ...notes];
    for (const rate of [44_100, 48_000]) {
      for (const root of roots) {
        const cycle = cycleFor(rate, root);
        expect(Number.isInteger(cycle)).toBe(true);
        // A cycle is a whole number of samples, so it misses its note by up to half a sample: at most a part in
        // 1300 of the shortest cycle (668 samples at 44.1 kHz), which is 0.0011 octaves, a little over a cent.
        const octaves = Math.log2(rate / cycle / root);
        expect(Math.abs(octaves - Math.round(octaves))).toBeLessThan(0.0012);
        const buzz = root * 2 ** Math.round(octaves);
        expect(buzz).toBeGreaterThanOrEqual(33);
        expect(buzz).toBeLessThan(66);
      }
    }
  });

  it("is a length one can work with whatever is claimed", () => {
    expect(cycleFor(48_000, Number.NaN)).toBe(960);
    expect(cycleFor(48_000, 0)).toBe(960);
    expect(cycleFor(48_000, -49)).toBe(960);
    expect(cycleFor(48_000, Number.POSITIVE_INFINITY)).toBe(960);
    expect(cycleFor(Number.NaN, 49)).toBe(980);
    expect(cycleFor(-1, 49)).toBe(980);
    expect(cycleFor(48_000, 1e-300)).toBeGreaterThan(726);
    expect(cycleFor(48_000, 1e300)).toBeLessThan(1456);
    expect(cycleFor(10, 49)).toBe(1);
  });
});

describe("A stretched sound", () => {
  it("is as many times as long as asked, to the sample", () => {
    for (const length of [1, 7, 999, 1001, 4801, 48_001]) {
      const sound = noise(length);
      for (const factor of [0.25, 0.5, 1, 1.5, 2, 4, 8]) {
        for (const cycle of [980, 64]) expect(stretch(sound, factor, cycle)).toHaveLength(Math.round(length * factor));
      }
    }
    expect(stretch(new Float32Array(0), 4, CYCLE)).toHaveLength(0);
    expect(stretch(new Float32Array(1), 0.25, CYCLE)).toHaveLength(0);
  });

  it("is stretched no further than eight times and a quarter, and is left alone by a factor that is no number", () => {
    const sound = noise(1001);
    expect(stretch(sound, 100, CYCLE)).toEqual(stretch(sound, 8, CYCLE));
    expect(stretch(sound, 0.01, CYCLE)).toEqual(stretch(sound, 0.25, CYCLE));
    expect(stretch(sound, -3, CYCLE)).toEqual(stretch(sound, 0.25, CYCLE));
    for (const factor of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(stretch(sound, factor, CYCLE)).toEqual(sound);
  });

  it("is cut into cycles of 20 ms where the cycle claimed is none", () => {
    const sound = noise(4801);
    const usual = stretch(sound, 2, 960);
    for (const cycle of [Number.NaN, Number.POSITIVE_INFINITY, 0, -980]) expect(stretch(sound, 2, cycle)).toEqual(usual);
    // A cycle of half a sample more or less is the nearest whole one.
    expect(stretch(sound, 2, 980.4)).toEqual(stretch(sound, 2, CYCLE));
    // Even the shortest cycle there is gives a sound and not a hang.
    expect(stretch(sound, 2, 1).every((value) => Math.abs(value) <= 1)).toBe(true);
  });

  it("is the sound itself at a factor of 1, in an array of its own", () => {
    for (const length of [48_000, 48_001, 7]) {
      const sound = noise(length);
      const same = stretch(sound, 1, CYCLE);
      expect(same).not.toBe(sound);
      expect(same.buffer).not.toBe(sound.buffer);
      // Not merely close: the same numbers.
      expect(same).toEqual(sound);
    }
  });

  it("plays every cycle as often as the factor says, the repeats spread evenly", () => {
    const sound = numbered(12, 64);
    expect(taken(stretch(sound, 4, 64), 64)).toEqual(Array.from({ length: 48 }, (_, piece) => Math.floor(piece / 4)));
    expect(taken(stretch(sound, 2, 64), 64)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11]);
    expect(taken(stretch(sound, 1.5, 64), 64)).toEqual([0, 0, 1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11]);
    expect(taken(stretch(sound, 0.5, 64), 64)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(taken(stretch(sound, 0.25, 64), 64)).toEqual([0, 4, 8]);
  });

  it("keeps its pitch: a tone of 1000 Hz is one of 1000 Hz at twice and at four times its length", () => {
    const tone = sine(RATE, 1000);
    // A cycle is no whole number of the tone's waves (48 samples each), so every repeat breaks into the wave.
    expect(CYCLE % 48).not.toBe(0);
    const bins = Array.from({ length: 39 }, (_, index) => 200 + index * 100);
    for (const factor of [2, 4]) {
      const long = stretch(tone, factor, CYCLE);
      const powers = bins.map((hz) => power(long, hz));
      // Of every hundred Hz from 200 to 4000 it is strongest at 1000, far above the octave below it and the one
      // above (measured: 37 and 51 dB at twice the length, 35 and 48 dB at four times).
      expect(bins[powers.indexOf(Math.max(...powers))]).toBe(1000);
      expect(dB(power(long, 1000) / power(long, 500))).toBeGreaterThan(30);
      expect(dB(power(long, 1000) / power(long, 2000))).toBeGreaterThan(30);
      // Counted by its changes of sign it is a tone of 1000 Hz to within 3 %: a join can swallow a change of sign
      // or add one, and there is one join to 41 of them (measured: 990 and 985 Hz).
      expect(Math.abs(crossings(long) / 2 - 1000)).toBeLessThan(30);
    }
  });

  it("keeps its timing: what happens a quarter of the way through the sound happens a quarter of the way through the longer one", () => {
    const sound = new Float32Array(RATE);
    sound[RATE / 4] = 1;
    sound[(RATE * 3) / 4] = 1;
    const long = stretch(sound, 2, CYCLE);
    const heard = Array.from(long.keys()).filter((index) => long[index]! > 0.5);
    // Each click is heard twice, a cycle apart; its first is where the click belongs, to within a cycle (they
    // come 240 and 720 samples early: as far as each click lies into its own cycle).
    expect(heard).toHaveLength(4);
    expect(heard[1]! - heard[0]!).toBe(CYCLE);
    expect(heard[3]! - heard[2]!).toBe(CYCLE);
    expect(Math.abs(heard[0]! - long.length / 4)).toBeLessThan(CYCLE);
    expect(Math.abs(heard[2]! - (long.length * 3) / 4)).toBeLessThan(CYCLE);
  });

  it("buzzes at the pitch of its cycle: noise stretched to four times its length repeats itself a cycle later", () => {
    const hiss = noise(RATE);
    for (const cycle of [CYCLE, 802]) {
      const beside = Math.round(cycle * 1.37);
      const long = stretch(hiss, 4, cycle);
      // Three pieces in four are a repeat of the one before, so three quarters of it are what they were a cycle
      // earlier (measured: 0.75), and nothing of it is what it was 1.37 cycles earlier (under 0.001).
      expect(alike(long, cycle)).toBeGreaterThan(0.7);
      expect(Math.abs(alike(long, beside))).toBeLessThan(0.02);
      // The noise itself has no such thing in it.
      expect(Math.abs(alike(hiss, cycle))).toBeLessThan(0.02);
    }
  });

  it("does not click where its pieces are joined", () => {
    // A tone of 2 Hz: one wave is as long as 24 cycles and a half.
    const slow = sine(RATE, 2);
    const own = jump(slow);
    for (const factor of [0.5, 1.5, 2, 4, 8]) {
      const long = stretch(slow, factor, CYCLE);
      // A join is a step of up to a cycle's worth of the tone's rise or fall. The crossfade spreads it over its 61
      // samples, so no step is larger than the tone's own largest plus 980 / 62 of it: 16.8 times the tone's own
      // (measured: 15.3 to 16.5 times, 0.004 of full scale). Cut hard, a join would be 980 times the tone's own.
      expect(jump(long)).toBeLessThan(own * (1 + CYCLE / (FADE + 1)) * 1.001);
    }
  });

  it("keeps its level", () => {
    const hiss = noise(RATE, 7);
    // A crossfade between two pieces of noise is a little quieter than either, for a sixteenth of the time
    // (measured: 0.4 to 1.1 % quieter in all).
    for (const factor of [0.25, 0.5, 1.5, 2, 4, 8]) expect(Math.abs(rms(stretch(hiss, factor, CYCLE)) / rms(hiss) - 1)).toBeLessThan(0.03);
  });

  it("is played over and over as a whole where it is shorter than a cycle", () => {
    const short = Float32Array.from({ length: 100 }, (_, index) => index / 100);
    const long = stretch(short, 3, CYCLE);
    expect(long).toHaveLength(300);
    expect(long.subarray(0, 100)).toEqual(short);
    // After the crossfade of a join (8 samples here) it is the sound again.
    expect(long.subarray(108, 200)).toEqual(short.subarray(8));
    expect(long.subarray(208, 300)).toEqual(short.subarray(8));
    expect(long.every((value) => value >= 0 && value <= short[99]!)).toBe(true);
  });

  it("ends with the end of the sound where a piece would run past it, not with silence", () => {
    // Two cycles and a half: the last pieces would read half a cycle that is not there.
    const sound = Float32Array.from({ length: 160 }, (_, index) => 1 + index / 160);
    const long = stretch(sound, 2, 64);
    expect(long).toHaveLength(320);
    expect(long.every((value) => value >= 1 && value < 2)).toBe(true);
    expect(long.subarray(256 + 8)).toEqual(sound.subarray(96 + 8));
    expect(long[319]).toBe(sound[159]);
  });

  it("stretches a quarter of a minute to a minute in well under a second", () => {
    const sound = noise(15 * RATE);
    const before = performance.now();
    const long = stretch(sound, 4, CYCLE);
    const took = performance.now() - before;
    expect(long).toHaveLength(60 * RATE);
    // Measured: 4 ms.
    expect(took).toBeLessThan(1000);
  });
});
