import { describe, expect, it } from "vitest";
import { barsFor, levelFor, loudOf, midiOf, mixdown, onGrid, onsets, peakOf, peaks, pitchOf, reversed, semitonesFrom, shapeOf, soundSpan, tempoOf } from "../src/sample-analysis";

// ---- sounds, made by hand -----------------------------------------------------------------

const RATE = 48_000;

/** Noise that is the same in every run: numbers from −1 to 1. */
const noise = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b_79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 2 ** 31 - 1;
  };
};

const blank = (seconds: number, rate = RATE): Float32Array<ArrayBuffer> => new Float32Array(Math.round(seconds * rate));
const place = (seconds: number, rate = RATE): number => Math.round(seconds * rate);

/** Adds a wave to a recording from `from` seconds on, `seconds` long. It begins and ends as it comes: no fade. */
const wave = (shape: (turn: number) => number) => (into: Float32Array, hz: number, from: number, seconds: number, level: number, rate = RATE): Float32Array => {
  const start = place(from, rate);
  for (let index = 0; index < place(seconds, rate) && start + index < into.length; index += 1) into[start + index]! += level * shape((hz * index) / rate);
  return into;
};
const sine = wave((turn) => Math.sin(2 * Math.PI * turn));
const saw = wave((turn) => 2 * (turn % 1) - 1);
const square = wave((turn) => (turn % 1 < 0.5 ? 1 : -1));

/** A hit: a burst of noise that dies away, as a clap or a hi-hat does. `decay` is the time in which it falls to about a third. */
const hit = (into: Float32Array, when: number, level: number, decay: number, random: () => number, rate = RATE): Float32Array => {
  const start = place(when, rate);
  for (let index = 0; index < place(decay * 8, rate) && start + index < into.length; index += 1) into[start + index]! += level * random() * Math.exp(-index / (decay * rate));
  return into;
};

/** A kick: a tone that falls from 150 Hz to 50 and dies away. */
const kick = (into: Float32Array, when: number, level: number, rate = RATE): Float32Array => {
  const start = place(when, rate);
  let turn = 0;
  for (let index = 0; index < place(0.35, rate) && start + index < into.length; index += 1) {
    const time = index / rate;
    turn += (50 + 100 * Math.exp(-time / 0.03)) / rate;
    into[start + index]! += level * Math.sin(2 * Math.PI * turn) * Math.exp(-time / 0.08);
  }
  return into;
};

/** Four on the floor with a hi-hat on every off-beat, `beats` long. */
const fourFloor = (bpm: number, beats: number, rate = RATE): Float32Array => {
  const beat = 60 / bpm;
  const loop = blank(beat * beats, rate);
  const random = noise(6);
  for (let count = 0; count < beats; count += 1) {
    kick(loop, count * beat, 0.8, rate);
    hit(loop, (count + 0.5) * beat, 0.15, 0.012, random, rate);
  }
  return loop;
};

/** How far the worst of `wanted` is from the nearest of `found`, in seconds. */
const worst = (found: readonly number[], wanted: readonly number[]): number => Math.max(...wanted.map((want) => Math.min(Number.POSITIVE_INFINITY, ...found.map((got) => Math.abs(got - want)))));
/** The smallest distance between two hits that follow one another. */
const closest = (found: readonly number[]): number => Math.min(Number.POSITIVE_INFINITY, ...found.slice(1).map((time, index) => time - found[index]!));
const cents = (hz: number, wanted: number): number => 1200 * Math.log2(hz / wanted);

// ---- how loud -------------------------------------------------------------------------------

describe("How loud a recording is", () => {
  it("makes one channel of two, and leaves one as it is", () => {
    const left = Float32Array.from([1, 0.5, -0.5, 0]);
    const right = Float32Array.from([0, 0.5, 0.5, -1]);
    expect([...mixdown([left, right])]).toEqual([0.5, 0.5, 0, -0.5]);
    expect(mixdown([left])).toBe(left);
    expect(mixdown([])).toHaveLength(0);
    expect([...left]).toEqual([1, 0.5, -0.5, 0]);
  });

  it("finds the highest sample, whichever way it points", () => {
    expect(peakOf(Float32Array.from([0.1, -0.75, 0.3]))).toBe(0.75);
    expect(peakOf(Float32Array.from([0.1, 0.5, -0.25]))).toBe(0.5);
    expect(peakOf(new Float32Array(0))).toBe(0);
    expect(peakOf(blank(0.1))).toBe(0);
  });

  it("measures it where it is loudest, over 300 ms", () => {
    // A sine is its height divided by the root of two, however long it is.
    expect(loudOf(sine(blank(1), 440, 0, 1, 0.5), RATE)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    expect(loudOf(sine(blank(0.1), 440, 0, 0.1, 0.5), RATE)).toBeCloseTo(0.5 / Math.SQRT2, 3);
    // A long quiet recording with 300 ms of loud in it is as loud as those.
    const mostlyQuiet = sine(sine(blank(4), 440, 0, 4, 0.01), 220, 2.2, 0.3, 0.5);
    expect(loudOf(mostlyQuiet, RATE)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    // A short hit in a long silence is spread over the 300 ms it is measured on.
    const short = sine(blank(2), 440, 1, 0.075, 0.8);
    expect(loudOf(short, RATE)).toBeCloseTo((0.8 / Math.SQRT2) * Math.sqrt(0.075 / 0.3), 2);
    expect(loudOf(blank(1), RATE)).toBe(0);
    expect(loudOf(new Float32Array(0), RATE)).toBe(0);
  });

  it("brings a recording to the level of the rings' own sounds", () => {
    const tone = sine(blank(1), 440, 0, 1, 0.5);
    expect(levelFor(tone, RATE)).toBeCloseTo(0.25 / (0.5 / Math.SQRT2), 3);
    const factor = levelFor(tone, RATE);
    expect(loudOf(tone.map((value) => value * factor), RATE)).toBeCloseTo(0.25, 3);
    // Too loud is turned down, a target of one's own is met.
    expect(levelFor(sine(blank(1), 440, 0, 1, 1), RATE)).toBeCloseTo(0.25 * Math.SQRT2, 3);
    expect(levelFor(tone, RATE, 0.1)).toBeCloseTo(0.1 / (0.5 / Math.SQRT2), 3);
  });

  it("never turns it up past the ceiling, never more than eightfold, and leaves silence alone", () => {
    // A click: next to nothing over 300 ms, but its peak is where it is.
    const click = sine(blank(1), 6000, 0.5, 0.001, 0.9);
    expect(0.25 / loudOf(click, RATE)).toBeGreaterThan(3);
    expect(levelFor(click, RATE)).toBeCloseTo(0.9 / peakOf(click), 6);
    expect(levelFor(click, RATE, 0.25, 0.5)).toBeCloseTo(0.5 / peakOf(click), 6);
    expect(levelFor(sine(blank(1), 440, 0, 1, 0.01), RATE)).toBe(8);
    expect(levelFor(sine(blank(1), 440, 0, 1, 0.0001), RATE)).toBe(8);
    expect(levelFor(blank(1), RATE)).toBe(1);
    expect(levelFor(new Float32Array(0), RATE)).toBe(1);
    const random = noise(11);
    for (const level of [0.001, 0.02, 0.3, 1]) {
      const sound = hit(sine(blank(1), 110, 0.1, 0.6, level * 0.5), 0.3, level, 0.02, random);
      const factor = levelFor(sound, RATE);
      expect(factor).toBeLessThanOrEqual(8);
      expect(peakOf(sound) * factor).toBeLessThanOrEqual(0.9 + 1e-9);
    }
  });
});

// ---- where it is ----------------------------------------------------------------------------

describe("Where the sound is", () => {
  it("begins just before the sound and ends a little after it", () => {
    const sound = sine(blank(1.2), 440, 0.5, 0.2, 0.5);
    const { from, to } = soundSpan(sound, RATE);
    // 3 ms in front, 30 ms behind: no more than that, and not a sample less than the sound.
    expect(from).toBeLessThanOrEqual(place(0.5));
    expect(from).toBeGreaterThanOrEqual(place(0.5 - 0.003) - 2);
    expect(to).toBeGreaterThanOrEqual(place(0.7));
    expect(to).toBeLessThanOrEqual(place(0.7 + 0.03) + 2);
  });

  it("takes what lies 50 dB under the peak for silence, and what lies above it for sound", () => {
    const random = noise(12);
    // A hit that dies away over a hiss 70 dB down: the hiss is not the sound, the tail of the hit is, down to 50 dB.
    const sound = hit(blank(2), 0.4, 0.8, 0.05, random);
    for (let index = 0; index < sound.length; index += 1) sound[index]! += 0.000_25 * random();
    const { from, to } = soundSpan(sound, RATE);
    expect(from).toBeLessThanOrEqual(place(0.4));
    expect(from).toBeGreaterThanOrEqual(place(0.4 - 0.003) - 2);
    // Its envelope crosses 50 dB under its start after 5.76 times its decay; the noise in it is rarely at its envelope.
    const gone = 0.4 + 0.05 * Math.log(10 ** (50 / 20));
    expect(to).toBeGreaterThan(place(gone - 0.06));
    expect(to).toBeLessThanOrEqual(place(gone + 0.03) + 2);
    // A hiss only 40 dB down is sound, all of it.
    const loudHiss = hit(blank(1), 0.4, 0.8, 0.05, random);
    for (let index = 0; index < loudHiss.length; index += 1) loudHiss[index]! += 0.008 * random();
    expect(soundSpan(loudHiss, RATE)).toEqual({ from: 0, to: loudHiss.length });
  });

  it("does not take a stray sample for the beginning", () => {
    const sound = sine(blank(1), 220, 0.5, 0.3, 0.8);
    sound[place(0.1)] = 0.02;
    sound[place(0.95)] = -0.02;
    const { from, to } = soundSpan(sound, RATE);
    expect(from).toBeGreaterThanOrEqual(place(0.5 - 0.003) - 2);
    expect(from).toBeLessThanOrEqual(place(0.5));
    expect(to).toBeLessThanOrEqual(place(0.8 + 0.03) + 2);
  });

  it("stays within the recording, and is all of a silent one", () => {
    const full = sine(blank(0.5), 440, 0, 0.5, 0.5);
    expect(soundSpan(full, RATE)).toEqual({ from: 0, to: full.length });
    expect(soundSpan(blank(0.5), RATE)).toEqual({ from: 0, to: place(0.5) });
    expect(soundSpan(new Float32Array(0), RATE)).toEqual({ from: 0, to: 0 });
    expect(soundSpan(Float32Array.from([0.5]), RATE)).toEqual({ from: 0, to: 1 });
  });

  it("draws a recording as the lowest and the highest of each of its parts", () => {
    const samples = Float32Array.from([0, 1, -1, 0.5, -0.5, 0.25, 0.75, -0.25]);
    expect([...peaks(samples, 4)]).toEqual([0, 1, -1, 0.5, -0.5, 0.25, -0.25, 0.75]);
    expect([...peaks(samples, 2)]).toEqual([-1, 1, -0.5, 0.75]);
    expect([...peaks(samples, 1)]).toEqual([-1, 1]);
    // A stretch of it, and parts that do not come out even: every sample is in one of them.
    expect([...peaks(samples, 2, 2, 6)]).toEqual([-1, 0.5, -0.5, 0.25]);
    expect([...peaks(samples, 3)]).toEqual([0, 1, -1, 0.5, -0.25, 0.75]);
    // Drawn wider than it is long, every part shows the sample it stands on.
    expect([...peaks(Float32Array.from([0.5, -0.5]), 4)]).toEqual([0.5, 0.5, 0.5, 0.5, -0.5, -0.5, -0.5, -0.5]);
    expect(peaks(samples, 0)).toHaveLength(0);
    expect([...peaks(new Float32Array(0), 3)]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...peaks(samples, 2, 5, 5)]).toEqual([0, 0, 0, 0]);
    const tone = sine(blank(1), 100, 0, 1, 0.7);
    const drawn = peaks(tone, 300);
    expect(drawn).toHaveLength(600);
    for (let part = 0; part < 300; part += 1) {
      expect(drawn[part * 2]).toBeLessThanOrEqual(drawn[part * 2 + 1]!);
      // A part is 160 samples: a third of a round of this tone, so never all of its height, and never more than it.
      expect(drawn[part * 2 + 1]! - drawn[part * 2]!).toBeLessThan(1.4);
    }
    expect(Math.max(...drawn)).toBeCloseTo(0.7, 3);
    expect(Math.min(...drawn)).toBeCloseTo(-0.7, 3);
  });

  it("plays a copy backwards", () => {
    const samples = Float32Array.from([0.25, 0.5, -0.75]);
    const back = reversed(samples);
    expect([...back]).toEqual([-0.75, 0.5, 0.25]);
    expect([...samples]).toEqual([0.25, 0.5, -0.75]);
    expect(back).not.toBe(samples);
    expect(reversed(new Float32Array(0))).toHaveLength(0);
    expect([...reversed(reversed(samples))]).toEqual([...samples]);
  });
});

// ---- hits -----------------------------------------------------------------------------------

describe("Hits", () => {
  it("are found where they begin: eight claps on a grid, to a few samples", () => {
    const times = [0.1, 0.35, 0.6, 0.85, 1.1, 1.35, 1.6, 1.85].map((time) => time + 0.001_23);
    const random = noise(1);
    const loop = blank(2.2);
    for (const time of times) hit(loop, time, 0.6, 0.03, random);
    for (const sensitivity of [0, 0.5, 1]) {
      const found = onsets(loop, RATE, sensitivity);
      expect(found).toHaveLength(times.length);
      expect(worst(found, times)).toBeLessThan(0.01);
    }
    // In fact much nearer than the 10 ms promised.
    expect(worst(onsets(loop, RATE), times)).toBeLessThan(0.001);
    // At another sample rate too.
    const cd = blank(2.2, 44_100);
    for (const time of times) hit(cd, time, 0.6, 0.03, random, 44_100);
    expect(onsets(cd, 44_100)).toHaveLength(times.length);
    expect(worst(onsets(cd, 44_100), times)).toBeLessThan(0.001);
  });

  it("are found wherever they fall and however they die away", () => {
    for (let seed = 20; seed < 32; seed += 1) {
      const random = noise(seed);
      const loop = blank(3);
      const times: number[] = [];
      for (let time = 0.05 + (random() + 1) * 0.05; time < 2.8; time += 0.12 + (random() + 1) * 0.2) {
        times.push(time);
        hit(loop, time, 0.3 + 0.3 * (random() + 1), 0.01 + 0.02 * (random() + 1), random);
      }
      const found = onsets(loop, RATE);
      expect(found).toHaveLength(times.length);
      expect(worst(found, times)).toBeLessThan(0.01);
    }
  });

  it("begin at once in a sound that does", () => {
    const random = noise(2);
    const claps = hit(hit(blank(1), 0, 0.6, 0.03, random), 0.5, 0.6, 0.03, random);
    expect(worst(onsets(claps, RATE), [0, 0.5])).toBeLessThan(0.001);
    expect(onsets(claps, RATE)[0]).toBeLessThan(0.01);
    const kicks = kick(kick(blank(1), 0, 0.8), 0.5, 0.8);
    expect(onsets(kicks, RATE)).toHaveLength(2);
    expect(worst(onsets(kicks, RATE), [0, 0.5])).toBeLessThan(0.001);
    // A sine begins at nothing: its hit is where it first stands out, a sample or two in.
    const tone = onsets(sine(blank(1), 440, 0, 1, 0.5), RATE);
    expect(tone).toHaveLength(1);
    expect(tone[0]).toBeLessThan(0.001);
  });

  it("are the kicks alone for a coarse ear, and the quiet hi-hats between them too for a fine one", () => {
    const kicks = [0, 0.4, 0.8, 1.2, 1.6];
    const hats = [0.2, 0.6, 1, 1.4, 1.8];
    const random = noise(4);
    const loop = blank(2);
    for (const time of kicks) kick(loop, time, 0.8);
    for (const time of hats) hit(loop, time, 0.08, 0.012, random);
    const coarse = onsets(loop, RATE, 0.2);
    expect(coarse).toHaveLength(kicks.length);
    expect(worst(coarse, kicks)).toBeLessThan(0.01);
    const fine = onsets(loop, RATE, 0.9);
    expect(fine).toHaveLength(kicks.length + hats.length);
    expect(worst(fine, [...kicks, ...hats])).toBeLessThan(0.01);
    // The finer the ear, the more it finds: never fewer.
    const counts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((sensitivity) => onsets(loop, RATE, sensitivity).length);
    for (let index = 1; index < counts.length; index += 1) expect(counts[index]).toBeGreaterThanOrEqual(counts[index - 1]!);
    // A hi-hat that falls onto the tail of a kick, where the kick is still far louder than it.
    const onTail = blank(2);
    for (const time of [0.1, 0.55, 1, 1.45]) hit(kick(onTail, time, 0.8), time + 0.08, 0.1, 0.012, random);
    expect(worst(onsets(onTail, RATE, 0.9), [0.1, 0.18, 0.55, 0.63, 1, 1.08, 1.45, 1.53])).toBeLessThan(0.01);
    expect(onsets(onTail, RATE, 0.9)).toHaveLength(8);
  });

  it("are one hit at its start in a tone that holds, however low it is and however it is shaped", () => {
    for (const hz of [30, 41.2, 55, 110, 440, 2000]) for (const shape of [sine, saw, square]) for (const sensitivity of [0.5, 1]) {
      // The tone is cut off as it stands: the end of a sound is no hit.
      const found = onsets(shape(blank(1.5), hz, 0.2, 1.003, 0.5), RATE, sensitivity);
      expect(found).toHaveLength(1);
      expect(Math.abs(found[0]! - 0.2)).toBeLessThan(0.01);
    }
  });

  it("are none, or one at most, in noise that fades in slowly; one in noise that is there at once", () => {
    const random = noise(5);
    const fading = blank(3);
    for (let index = 0; index < fading.length; index += 1) fading[index] = 0.5 * random() * Math.min(1, index / (2 * RATE));
    for (const sensitivity of [0, 0.5, 1]) expect(onsets(fading, RATE, sensitivity).length).toBeLessThanOrEqual(1);
    const steady = blank(3);
    for (let index = 0; index < steady.length; index += 1) steady[index] = 0.3 * random();
    for (const sensitivity of [0, 0.5, 1]) expect(onsets(steady, RATE, sensitivity)).toEqual([0]);
  });

  it("are at least 50 ms apart and come in order", () => {
    const random = noise(7);
    // A flam: two strokes 20 ms apart are one hit. A roll of sixteenths at 200 BPM is eight.
    const flam = hit(hit(blank(1), 0.3, 0.6, 0.02, random), 0.32, 0.6, 0.02, random);
    expect(onsets(flam, RATE, 1)).toHaveLength(1);
    const roll = blank(1);
    const strokes = [0, 1, 2, 3, 4, 5, 6, 7].map((stroke) => 0.1 + stroke * 0.075);
    for (const time of strokes) hit(roll, time, 0.5, 0.012, random);
    expect(onsets(roll, RATE)).toHaveLength(8);
    expect(worst(onsets(roll, RATE), strokes)).toBeLessThan(0.01);
    const dense = blank(3);
    for (let time = 0.05; time < 2.9; time += 0.03 + 0.04 * (random() + 1)) hit(dense, time, 0.2 + 0.3 * (random() + 1), 0.008, random);
    for (const sensitivity of [0.2, 0.5, 1]) {
      const found = onsets(dense, RATE, sensitivity);
      expect(found.length).toBeGreaterThan(10);
      expect(closest(found)).toBeGreaterThanOrEqual(0.05);
    }
  });

  it("are none where there is nothing, whatever is asked", () => {
    expect(onsets(new Float32Array(0), RATE)).toEqual([]);
    expect(onsets(blank(1), RATE)).toEqual([]);
    expect(onsets(Float32Array.from([0.5]), RATE)).toEqual([0]);
    const loop = fourFloor(150, 4);
    expect(onsets(loop, RATE, 7)).toEqual(onsets(loop, RATE, 1));
    expect(onsets(loop, RATE, -3)).toEqual(onsets(loop, RATE, 0));
    expect(onsets(loop, 0)).toEqual([]);
  });
});

// ---- how fast -------------------------------------------------------------------------------

describe("How many bars a loop is", () => {
  it("is the number whose length is nearest, with the tempo at which the loop is exactly that long", () => {
    expect(barsFor(6.4, 150)).toEqual({ bars: 4, bpm: 150 });
    expect(barsFor(3.2, 150)).toEqual({ bars: 2, bpm: 150 });
    expect(barsFor(1.6, 150)).toEqual({ bars: 1, bpm: 150 });
    expect(barsFor(12.8, 150)).toEqual({ bars: 8, bpm: 150 });
    expect(barsFor(25.6, 150)).toEqual({ bars: 16, bpm: 150 });
    // A loop at 140 in a Kreisel at 150 is four bars at 140, and one of two seconds is one bar at 120.
    expect(barsFor(6.86, 150).bars).toBe(4);
    expect(barsFor(6.86, 150).bpm).toBeCloseTo(139.94, 1);
    expect(barsFor(2, 150)).toEqual({ bars: 1, bpm: 120 });
    expect(barsFor(8, 120)).toEqual({ bars: 4, bpm: 120 });
    expect(barsFor(7.5, 120).bars).toBe(4);
    expect(barsFor(7.5, 120).bpm).toBeCloseTo(128, 6);
  });

  it("takes the neighbouring number where the nearest would be more than a quarter off", () => {
    // 2.39 s is nearer to one bar of 1.6 s than to two. As one bar it would be at two thirds of the tempo, as two at 1.34 times.
    expect(barsFor(2.39, 150).bars).toBe(2);
    expect(barsFor(2.39, 150).bpm).toBeCloseTo(480 / 2.39, 6);
    // Where neither is within a quarter, the one that is less far off: 2.2 s is one slow bar, not two fast ones.
    expect(barsFor(2.2, 150).bars).toBe(1);
    expect(barsFor(2.2, 150).bpm).toBeCloseTo(240 / 2.2, 6);
    // There is no half bar and nothing beyond sixteen: the tempo says how far off that is.
    expect(barsFor(0.8, 150)).toEqual({ bars: 1, bpm: 300 });
    expect(barsFor(40, 150)).toEqual({ bars: 16, bpm: 96 });
  });

  it("always answers with one of its five numbers and the tempo that goes with it", () => {
    for (const bpm of [70, 100, 128, 150, 200]) for (let seconds = 0.3; seconds < 60; seconds *= 1.07) {
      const answer = barsFor(seconds, bpm);
      expect([1, 2, 4, 8, 16]).toContain(answer.bars);
      expect(answer.bpm).toBeCloseTo((answer.bars * 240) / seconds, 9);
      // Between one bar and sixteen it never asks for more than the root of two either way, and stays within a quarter where a number allows it.
      const ratio = answer.bpm / bpm;
      const bars = seconds / (240 / bpm);
      if (bars >= 1 && bars <= 16) {
        expect(ratio).toBeGreaterThan(0.7);
        expect(ratio).toBeLessThan(1.42);
      }
      const within = [1, 2, 4, 8, 16].some((count) => (count * 240) / seconds / bpm >= 0.75 && (count * 240) / seconds / bpm <= 1.34);
      if (within) expect(ratio >= 0.75 && ratio <= 1.34).toBe(true);
    }
    expect(barsFor(0, 150)).toEqual({ bars: 1, bpm: 150 });
    expect(barsFor(Number.NaN, 150)).toEqual({ bars: 1, bpm: 150 });
    expect(barsFor(4, 0).bars).toBe(1);
  });
});

describe("A loop's own tempo", () => {
  it("is heard from four on the floor with hi-hats between, to well under a beat a minute", () => {
    const tempo = tempoOf(fourFloor(150, 16), RATE);
    expect(Math.abs(tempo! - 150)).toBeLessThan(2);
    // Over four bars it is nearer than that; over one bar there are only four beats to measure on.
    expect(Math.abs(tempo! - 150)).toBeLessThan(0.2);
    expect(Math.abs(tempoOf(fourFloor(150, 4), RATE)! - 150)).toBeLessThan(2);
    for (const bpm of [100, 120, 128, 140, 160, 174]) expect(Math.abs(tempoOf(fourFloor(bpm, 16), RATE)! - bpm)).toBeLessThan(0.5);
    expect(Math.abs(tempoOf(fourFloor(150, 16, 44_100), 44_100)! - 150)).toBeLessThan(0.5);
  });

  it("is always between 70 and 200, and of two tempos that fit, the one nearer to a dance floor's", () => {
    // Hits half a second apart are 120 as well as 60 and 240. A loop at 70 with hi-hats between its beats is 140 as well.
    for (const bpm of [60, 70, 80, 90, 110, 130, 150, 170, 190, 200, 240]) {
      const tempo = tempoOf(fourFloor(bpm, 16), RATE)!;
      expect(tempo).toBeGreaterThanOrEqual(70);
      expect(tempo).toBeLessThanOrEqual(200);
      // It is the tempo, or twice or half of it.
      const octaves = Math.log2(tempo / bpm);
      expect(Math.abs(octaves - Math.round(octaves))).toBeLessThan(0.01);
    }
    expect(tempoOf(fourFloor(70, 16), RATE)).toBeCloseTo(140, 0);
  });

  it("is not said of a single hit, a tone or nothing", () => {
    expect(tempoOf(kick(blank(1), 0.1, 0.8), RATE)).toBeNull();
    expect(tempoOf(kick(kick(blank(1), 0.1, 0.8), 0.5, 0.8), RATE)).toBeNull();
    expect(tempoOf(sine(blank(4), 220, 0, 4, 0.4), RATE)).toBeNull();
    expect(tempoOf(blank(2), RATE)).toBeNull();
    expect(tempoOf(new Float32Array(0), RATE)).toBeNull();
    // Four hits in a third of a second: no beat fits in there twice.
    const random = noise(8);
    const burst = blank(0.4);
    for (const time of [0, 0.08, 0.16, 0.24]) hit(burst, time, 0.5, 0.01, random);
    expect(onsets(burst, RATE)).toHaveLength(4);
    expect(tempoOf(burst, RATE)).toBeNull();
  });
});

// ---- which note -----------------------------------------------------------------------------

describe("The pitch of a sound", () => {
  it("is found in a plain tone, from the lowest bass to the top of a lead", () => {
    for (const hz of [55, 110, 440, 1000]) {
      const pitch = pitchOf(sine(blank(1.2), hz, 0.1, 1, 0.5), RATE);
      expect(Math.abs(cents(pitch!.hz, hz))).toBeLessThan(2);
      expect(pitch!.clarity).toBeGreaterThan(0.98);
    }
    // The two ends of what is listened for, and just past them.
    for (const hz of [30, 32.7, 41.2, 1975.5, 2000]) expect(Math.abs(cents(pitchOf(sine(blank(1.2), hz, 0.1, 1, 0.5), RATE)!.hz, hz))).toBeLessThan(5);
    expect(pitchOf(sine(blank(1.2), 3000, 0.1, 1, 0.5), RATE)).toBeNull();
    expect(pitchOf(sine(blank(1.2), 20, 0.1, 1, 0.5), RATE)).toBeNull();
  });

  it("is the same at any sample rate, in a short sound, and at any level", () => {
    for (const rate of [22_050, 44_100, 96_000]) {
      const pitch = pitchOf(sine(blank(1.2, rate), 110, 0.1, 1, 0.5, rate), rate);
      expect(Math.abs(cents(pitch!.hz, 110))).toBeLessThan(2);
      expect(pitch!.clarity).toBeGreaterThan(0.98);
    }
    const short = pitchOf(sine(blank(0.2), 440, 0.02, 0.08, 0.5), RATE);
    expect(Math.abs(cents(short!.hz, 440))).toBeLessThan(10);
    expect(short!.clarity).toBeGreaterThan(0.9);
    expect(Math.abs(cents(pitchOf(sine(blank(1.2), 220, 0.1, 1, 0.003), RATE)!.hz, 220))).toBeLessThan(2);
  });

  it("is found behind a loud attack, in a wave full of overtones", () => {
    const random = noise(13);
    const pluck = saw(hit(blank(1.3), 0.1, 0.9, 0.006, random), 110, 0.13, 1, 0.4);
    const pitch = pitchOf(pluck, RATE);
    expect(Math.abs(cents(pitch!.hz, 110))).toBeLessThan(5);
    expect(pitch!.clarity).toBeGreaterThan(0.9);
    // A tone that dies away, as a plucked string does, and a square.
    const dying = saw(blank(1.5), 82.41, 0.1, 1.2, 0.6);
    for (let index = 0; index < dying.length; index += 1) dying[index]! *= Math.exp(-Math.max(0, index - place(0.1)) / (0.3 * RATE));
    expect(Math.abs(cents(pitchOf(dying, RATE)!.hz, 82.41))).toBeLessThan(5);
    expect(Math.abs(cents(pitchOf(square(blank(1.2), 196, 0.1, 1, 0.4), RATE)!.hz, 196))).toBeLessThan(5);
  });

  it("is one of the notes of a chord or the tone both belong to, if it is said at all", () => {
    for (const [low, high, ground] of [[220, 330, 110], [220, 277.18, 55], [261.63, 392, 130.81]] as const) {
      const pitch = pitchOf(sine(sine(blank(1.2), low, 0.1, 1, 0.3), high, 0.1, 1, 0.3), RATE);
      if (pitch) expect(Math.min(...[low, high, ground].map((note) => Math.abs(cents(pitch.hz, note))))).toBeLessThan(50);
    }
  });

  it("is not said of noise, of a kick that falls, of silence", () => {
    const random = noise(14);
    const hiss = blank(1);
    for (let index = 0; index < hiss.length; index += 1) hiss[index] = 0.4 * random();
    expect(pitchOf(hiss, RATE)).toBeNull();
    expect(pitchOf(hit(blank(1), 0.1, 0.8, 0.05, random), RATE)).toBeNull();
    // A sine that falls from 200 Hz to 50 while it dies away: where it is loud it has no pitch that holds.
    const falling = blank(0.6);
    let turn = 0;
    for (let index = 0; index < place(0.3); index += 1) {
      const time = index / RATE;
      turn += (200 - 150 * (time / 0.3)) / RATE;
      falling[place(0.05) + index] = 0.8 * Math.sin(2 * Math.PI * turn) * Math.exp(-time / 0.12);
    }
    const said = pitchOf(falling, RATE);
    expect(said === null || said.clarity < 0.8).toBe(true);
    expect(pitchOf(blank(1), RATE)).toBeNull();
    expect(pitchOf(new Float32Array(0), RATE)).toBeNull();
    expect(pitchOf(Float32Array.from([0.5, -0.5, 0.5]), RATE)).toBeNull();
    expect(pitchOf(sine(blank(1), 440, 0, 1, 0.5), 0)).toBeNull();
  });
});

describe("Notes", () => {
  it("are counted from the A of 440 Hz, which is 69", () => {
    expect(midiOf(440)).toBe(69);
    expect(midiOf(880)).toBe(81);
    expect(midiOf(220)).toBe(57);
    expect(midiOf(261.63)).toBeCloseTo(60, 3);
    expect(midiOf(466.16)).toBeCloseTo(70, 3);
    expect(midiOf(452.9)).toBeCloseTo(69.5, 2);
  });

  it("lie so many semitones from the nearest note of a name, in any octave", () => {
    expect(semitonesFrom(440, 9)).toBeCloseTo(0, 9);
    expect(semitonesFrom(466.16, 9)).toBeCloseTo(1, 3);
    expect(semitonesFrom(415.3, 9)).toBeCloseTo(-1, 3);
    // The octave does not matter, and a little sharp is a little above.
    for (const hz of [55, 110, 220, 880, 3520]) expect(semitonesFrom(hz, 9)).toBeCloseTo(0, 9);
    expect(semitonesFrom(445, 9)).toBeCloseTo(0.1956, 3);
    expect(semitonesFrom(261.63, 0)).toBeCloseTo(0, 3);
    expect(semitonesFrom(261.63, 2)).toBeCloseTo(-2, 3);
    expect(semitonesFrom(261.63, 11)).toBeCloseTo(1, 3);
    // Half an octave away is as far as it gets, and it never leaves −6..6.
    expect(Math.abs(semitonesFrom(440, 3))).toBeCloseTo(6, 9);
    for (let hz = 30; hz < 2000; hz *= 1.013) for (let name = 0; name < 12; name += 1) {
      const off = semitonesFrom(hz, name);
      expect(off).toBeGreaterThanOrEqual(-6);
      expect(off).toBeLessThanOrEqual(6);
      // Tuned down by that much, the pitch is on the note.
      const landed = midiOf(hz) - off - name;
      expect(Math.abs(landed / 12 - Math.round(landed / 12))).toBeLessThan(1e-9);
    }
    expect(semitonesFrom(0, 9)).toBe(0);
    expect(semitonesFrom(Number.NaN, 9)).toBe(0);
  });
});

// ---- what it is -------------------------------------------------------------------------------

describe("What a recording is when it comes in", () => {
  const beat = (bpm: number, steps: number, lead = 0, every = 2): Float32Array => {
    const step = 15 / bpm;
    const random = noise(4);
    const sound = blank(lead + steps * step);
    for (let at = 0; at < steps; at += every) hit(sound, lead + at * step, 0.6, 0.03, random);
    return sound;
  };

  it("counts the hits that lie on a grid", () => {
    expect(onGrid([0, 0.1, 0.2, 0.31, 0.45], 0.1)).toBeCloseTo(0.8);
    expect(onGrid([1, 1.1, 1.2], 0.1, 1)).toBe(1);
    expect(onGrid([], 0.1)).toBe(0);
    expect(onGrid([0, 1], 0)).toBe(0);
  });

  it("takes a loop that was cut to its bars whole, with the quiet after its last hit", () => {
    const loop = beat(150, 32);
    const shape = shapeOf(loop, RATE, 150);
    expect(shape).toEqual({ from: 0, to: loop.length, loop: { bars: 2, bpm: expect.closeTo(150, 1) as number } });
    // At another tempo of the Kreisel it is still two bars, and its own tempo is said.
    expect(shapeOf(loop, RATE, 140).loop).toEqual({ bars: 2, bpm: expect.closeTo(150, 1) as number });
  });

  it("begins a loop with silence in front at its first hit, and gives it whole bars at its own tempo", () => {
    const loop = beat(125, 32, 0.5);
    const shape = shapeOf(loop, RATE, 130);
    expect(shape.loop?.bars).toBe(2);
    expect(Math.abs((shape.loop?.bpm ?? 0) - 125)).toBeLessThan(1);
    expect(Math.abs(shape.from / RATE - 0.5)).toBeLessThan(0.01);
    expect(Math.abs((shape.to - shape.from) / RATE - 3.84)).toBeLessThan(0.03);
  });

  it("takes hits that lie where they like for a single sound: a sentence is no loop", () => {
    const random = noise(11);
    const speech = blank(3);
    for (const time of [0.21, 0.52, 0.71, 1.18, 1.33, 1.9, 2.36, 2.52]) hit(speech, time, 0.5, 0.05, random);
    const shape = shapeOf(speech, RATE, 150);
    expect(shape.loop).toBeNull();
    expect(Math.abs(shape.from / RATE - 0.207)).toBeLessThan(0.005);
    expect(shape.to).toBeLessThan(speech.length);
  });

  it("takes a short sound and a silent one for a single sound", () => {
    const random = noise(2);
    const short = blank(0.8);
    hit(short, 0.1, 0.6, 0.2, random);
    expect(shapeOf(short, RATE, 150).loop).toBeNull();
    expect(shapeOf(blank(4), RATE, 150)).toEqual({ from: 0, to: 4 * RATE, loop: null });
  });
});

// ---- a minute of sound ------------------------------------------------------------------------

describe("A minute of sound", () => {
  it("is looked through in a fraction of a second", () => {
    const random = noise(9);
    const minute = blank(60);
    for (let index = 0; index < minute.length; index += 1) minute[index] = 0.02 * random();
    for (let time = 0; time < 60; time += 0.2) hit(minute, time, 0.6, 0.02, random);
    const began = performance.now();
    const found = onsets(minute, RATE);
    const span = soundSpan(minute, RATE);
    const tempo = tempoOf(minute, RATE);
    const pitch = pitchOf(minute, RATE);
    const drawn = peaks(minute, 1200);
    const took = performance.now() - began;
    // About 60 ms on the laptop this was written on; two seconds were allowed.
    expect(took).toBeLessThan(1000);
    expect(found).toHaveLength(300);
    expect(span).toEqual({ from: 0, to: minute.length });
    expect(Math.abs(tempo! - 150)).toBeLessThan(0.5);
    expect(pitch).toBeNull();
    expect(drawn).toHaveLength(2400);
  });
});
