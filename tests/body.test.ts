import { describe, expect, it } from "vitest";
import { bessel, cleanBody, describeBody, diceBody, drumHz, modesOf, PLAIN, renderBody, sustains } from "../src/body";
import { deserialize, serialize, unpackBody } from "../src/codec";
import { BODY_SOUND, factoryProject, TRACK_COUNT, type Body } from "../src/model";
import { seeded } from "../src/patterns";

const body = (change: Partial<Body> = {}): Body => ({ kind: 0, size: 0.5, tight: 0.5, material: 0.5, exciter: 1, where: 0.3, ...change });
/** How much of `hz` there is in the samples (Goertzel). */
function strength(samples: Float32Array, hz: number, sampleRate: number): number {
  const turn = (2 * Math.PI * hz) / sampleRate;
  const coefficient = 2 * Math.cos(turn);
  let one = 0;
  let two = 0;
  for (const sample of samples) {
    const next = sample + coefficient * one - two;
    two = one;
    one = next;
  }
  return Math.sqrt(Math.max(0, one * one + two * two - coefficient * one * two)) / samples.length;
}

describe("the modes of a body", () => {
  it("knows the Bessel functions a round skin needs", () => {
    expect(bessel(0, 0)).toBeCloseTo(1, 6);
    expect(bessel(0, 2.4048)).toBeCloseTo(0, 3);
    expect(bessel(1, 3.8317)).toBeCloseTo(0, 3);
    expect(bessel(1, 1.8412)).toBeCloseTo(0.5819, 3);
    expect(bessel(3, 0)).toBeCloseTo(0, 6);
  });

  it("a skin struck in its middle sounds only its round modes; towards the rim the others wake", () => {
    const middle = modesOf(body({ where: 0 }), 100);
    const near = (ratio: number) => middle.find((mode) => Math.abs(mode.hz / 100 - ratio) < 0.01)!;
    const loud = Math.abs(near(1).level);
    expect(Math.abs(near(2.295).level)).toBeGreaterThan(loud * 0.05);
    expect(Math.abs(near(1.593).level)).toBeLessThan(loud * 0.08);
    expect(Math.abs(near(2.136).level)).toBeLessThan(loud * 0.02);
    const rim = modesOf(body({ where: 0.7 }), 100);
    const second = rim.find((mode) => Math.abs(mode.hz / 100 - 1.593) < 0.01)!;
    expect(Math.abs(second.level)).toBeGreaterThan(Math.abs(rim[0]!.level) * 0.5);
  });

  it("a string touched in its middle loses every second overtone, and is a little sharp where it is stiff", () => {
    const middle = modesOf(body({ kind: 1, where: 0, exciter: 2 }), 110);
    expect(middle[0]!.hz).toBeCloseTo(110, 5);
    expect(Math.abs(middle[1]!.level)).toBeLessThan(Math.abs(middle[0]!.level) * 1e-6);
    expect(Math.abs(middle[2]!.level)).toBeGreaterThan(Math.abs(middle[0]!.level) * 0.01);
    const end = modesOf(body({ kind: 1, where: 1, exciter: 2 }), 110);
    expect(Math.abs(end[1]!.level)).toBeGreaterThan(Math.abs(end[0]!.level) * 0.2);
    const slack = modesOf(body({ kind: 1, tight: 0 }), 110);
    expect(slack[9]!.hz).toBeGreaterThan(1100 * 1.02);
    expect(modesOf(body({ kind: 1, tight: 1 }), 110)[9]!.hz).toBeLessThan(1100 * 1.003);
  });

  it("a bar rests its second mode in the middle, a tube has only odd overtones, a bowl beats", () => {
    const bar = modesOf(body({ kind: 2, where: 0 }), 200);
    expect(bar[1]!.hz / 200).toBeCloseTo(2.756, 3);
    expect(Math.abs(bar[1]!.level)).toBeLessThan(Math.abs(bar[0]!.level) * 1e-6);
    expect(Math.abs(modesOf(body({ kind: 2, where: 1 }), 200)[1]!.level)).toBeGreaterThan(0.01);
    const tube = modesOf(body({ kind: 3, where: 0 }), 100);
    expect(tube.slice(0, 4).map((mode) => Math.round(mode.hz / 100))).toEqual([1, 3, 5, 7]);
    const bowl = modesOf(body({ kind: 4, material: 0.5 }), 300);
    expect(bowl[1]!.hz - bowl[0]!.hz).toBeGreaterThan(0.2);
    expect(bowl[1]!.hz - bowl[0]!.hz).toBeLessThan(5);
    expect(bowl[2]!.hz / 300).toBeCloseTo(2.83, 2);
    expect(modesOf(body({ kind: 4, material: 1 }), 300)[2]!.hz / 300).toBeCloseTo(2.32, 2);
  });

  it("rings longer in metal and glass than in wood, shorter when tight, longer when big", () => {
    const first = (change: Partial<Body>): number => modesOf(body({ kind: 2, ...change }), 220)[0]!.t60;
    expect(first({ material: 0 })).toBeLessThan(first({ material: 0.5 }) * 0.3);
    expect(first({ material: 0.5 })).toBeLessThan(first({ material: 1 }));
    expect(first({ tight: 1 })).toBeLessThan(first({ tight: 0 }) * 0.6);
    expect(first({ size: 1 })).toBeGreaterThan(first({ size: 0 }) * 2);
    // What is high dies first, in wood much sooner than in metal.
    const wood = modesOf(body({ kind: 2, material: 0 }), 220);
    const metal = modesOf(body({ kind: 2, material: 0.5 }), 220);
    expect(wood[2]!.t60 / wood[0]!.t60).toBeLessThan(metal[2]!.t60 / metal[0]!.t60);
    // The sound pad stretches all of it.
    expect(modesOf(body({ kind: 2 }), 220, { ...PLAIN, ring: 2 })[0]!.t60).toBeCloseTo(first({}) * 2, 5);
  });

  it("a soft mallet wakes less of what is high than a hard one, and an accent more", () => {
    const share = (change: Partial<Body>, force = 1): number => {
      const modes = modesOf(body({ kind: 1, where: 0.8, ...change }), 110, { ...PLAIN, force });
      return Math.abs(modes[11]!.level / modes[0]!.level);
    };
    expect(share({ exciter: 0 })).toBeLessThan(share({ exciter: 1 }) * 0.3);
    expect(share({ exciter: 1 }, 2)).toBeGreaterThan(share({ exciter: 1 }, 1));
    expect(share({ exciter: 1 }, 0)).toBeLessThan(share({ exciter: 1 }, 1));
  });

  it("on a ring without notes a bigger body is lower", () => {
    for (let kind = 0; kind < 5; kind += 1) {
      expect(drumHz(body({ kind, size: 1 }))).toBeLessThan(drumHz(body({ kind, size: 0 })) / 4);
      expect(drumHz(body({ kind, size: 1 }))).toBeGreaterThan(30);
    }
    expect(drumHz(body({ tight: 1 }))).toBeGreaterThan(drumHz(body({ tight: 0 })));
  });
});

describe("bodies as values", () => {
  it("keeps every value where it may be", () => {
    expect(cleanBody({ kind: 9, size: -3, tight: Number.NaN, material: "glas", exciter: 2.4, where: 7 })).toEqual({ kind: 4, size: 0, tight: 0.5, material: 0.5, exciter: 2, where: 1 });
    expect(cleanBody({})).toEqual({ kind: 0, size: 0.5, tight: 0.5, material: 0.5, exciter: 0, where: 0.3 });
    expect(cleanBody({ size: 0.123456 }).size).toBe(0.12);
  });

  it("dice give every ring a body that suits it, the same for the same throw", () => {
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      for (let seed = 1; seed < 40; seed += 1) {
        const made = diceBody(track, seeded(seed));
        expect(made).toEqual(cleanBody(made));
        expect(made).toEqual(diceBody(track, seeded(seed)));
        if (track === 0) expect(drumHz(made)).toBeLessThan(110);
        if (track === 2) expect(drumHz(made)).toBeGreaterThan(300);
        if (track < 3) expect(sustains(made)).toBe(false);
      }
    }
    expect(describeBody(body({ size: 0.9, material: 0.1, exciter: 0, where: 0 }))).toBe("Skin, big, Wood, struck softly, Middle");
    expect(describeBody(null)).toBe("no body yet");
  });

  it("travels in the link, and a ring cannot play a body it does not have", () => {
    const project = factoryProject();
    project.tracks[3]!.body = body({ kind: 4, size: 0.21, tight: 0.8, material: 1, exciter: 3, where: 0.66 });
    project.tracks[3]!.sound = BODY_SOUND;
    project.tracks[5]!.sound = BODY_SOUND;
    const back = deserialize(serialize(project));
    expect(back.tracks[3]!.body).toEqual(project.tracks[3]!.body);
    expect(back.tracks[3]!.sound).toBe(BODY_SOUND);
    expect(back.tracks[3]!.bild).toBeNull();
    expect(back.tracks[5]!.sound).toBe(0);
    expect(back.tracks[0]!.body).toBeNull();
    for (const hostile of [null, 7, "", "1.2.3", "1.2.3.4.5.6.7", "a.b.c.d.e.f", "1e3.0.0.0.0.0", "-1.50.50.50.0.50", "0.5000.50.50.0.50", "9".repeat(60)]) {
      expect(unpackBody(hostile)).toBeNull();
    }
    expect(unpackBody("9.300.50.50.9.50")).toEqual({ kind: 4, size: 1, tight: 0.5, material: 0.5, exciter: 4, where: 0.5 });
  });
});

describe("the sound of a body", () => {
  const rate = 44_100;

  it("is struck: starts and ends in silence, never clips, and has its pitch", () => {
    for (let kind = 0; kind < 5; kind += 1) {
      for (const exciter of [0, 1, 2]) {
        const sound = renderBody(body({ kind, exciter, where: 0.4 }), 220, rate);
        const { samples } = sound;
        expect(sound.loopEnd).toBe(0);
        expect(samples.length).toBeGreaterThan(rate * 0.04);
        expect(samples.length).toBeLessThanOrEqual(rate * 4);
        expect(samples.every((sample) => Number.isFinite(sample))).toBe(true);
        expect(Math.abs(samples[0]!)).toBeLessThan(0.02);
        expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.001);
        expect(samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0)).toBeLessThanOrEqual(0.981);
        // The lowest mode is there, and stronger than a pitch between the modes.
        const start = samples.subarray(0, Math.min(samples.length, rate / 4));
        expect(strength(start, kind === 4 ? 220.5 : 220, rate)).toBeGreaterThan(strength(start, 260, rate) * 2.5);
      }
    }
  });

  it("sounds the same every time, and differently where it is struck", () => {
    const one = renderBody(body({ kind: 0, where: 0.1 }), 90, rate);
    expect(renderBody(body({ kind: 0, where: 0.1 }), 90, rate).samples).toEqual(one.samples);
    const rim = renderBody(body({ kind: 0, where: 0.8 }), 90, rate);
    const high = (samples: Float32Array): number => strength(samples.subarray(0, 8000), 90 * 1.593, rate) / strength(samples.subarray(0, 8000), 90, rate);
    expect(high(rim.samples)).toBeGreaterThan(high(one.samples) * 3);
  });

  it("a slack skin drops in pitch after the blow, a tight one hardly", () => {
    const early = (tight: number): number => {
      const samples = renderBody(body({ kind: 0, tight, where: 0, exciter: 0, size: 1 }), 60, rate).samples.subarray(0, 900);
      return strength(samples, 84, rate) / strength(samples, 60, rate);
    };
    expect(early(0)).toBeGreaterThan(early(1) * 1.15);
  });

  it("is bowed or blown: goes round in a loop without a seam", () => {
    for (const [kind, exciter] of [[1, 3], [4, 3], [3, 4], [2, 4]] as const) {
      const made = body({ kind, exciter });
      expect(sustains(made)).toBe(true);
      const sound = renderBody(made, 196, rate);
      const { samples, loopStart, loopEnd } = sound;
      expect(loopEnd).toBe(samples.length);
      expect(loopEnd - loopStart).toBeGreaterThan(rate * 1.9);
      expect(sound.release).toBeGreaterThan(0.02);
      expect(samples.every((sample) => Number.isFinite(sample))).toBe(true);
      expect(Math.abs(samples[0]!)).toBeLessThan(0.01);
      // Going round, the step from the last sample to the first of the loop is no bigger than the steps inside it.
      let widest = 0;
      for (let index = loopStart + 1; index < loopEnd; index += 1) widest = Math.max(widest, Math.abs(samples[index]! - samples[index - 1]!));
      expect(Math.abs(samples[loopStart]! - samples[loopEnd - 1]!)).toBeLessThanOrEqual(widest * 1.05);
      // And it is as loud at the end of the loop as at its start.
      const rms = (from: number): number => Math.sqrt(samples.subarray(from, from + 4000).reduce((sum, sample) => sum + sample * sample, 0) / 4000);
      expect(rms(loopEnd - 4000) / rms(loopStart)).toBeGreaterThan(0.7);
      expect(rms(loopEnd - 4000) / rms(loopStart)).toBeLessThan(1.4);
      expect(strength(samples.subarray(loopStart), 196, rate)).toBeGreaterThan(strength(samples.subarray(loopStart), 230, rate) * 4);
    }
  });

  it("is made fast enough to be made while playing", () => {
    const started = performance.now();
    for (let kind = 0; kind < 5; kind += 1) renderBody(body({ kind, material: 1, size: 1, tight: 0 }), 110, 48_000);
    renderBody(body({ kind: 4, exciter: 3 }), 110, 48_000);
    expect(performance.now() - started).toBeLessThan(1500);
  });
});
