import { describe, expect, it } from "vitest";
import { pack, unpack } from "../src/codec";
import { BAR, emptyPattern, emptyStep, factoryProject, technoProject, WEATHER_MAX, type Pattern } from "../src/model";
import { behindKick, meeting, meetSteps } from "../src/patterns";
import { cleanTide, tideShare, TIDES, weatherAt } from "../src/weather";

const ring = (length: number, hits: number[]): Pattern => {
  const pattern = emptyPattern();
  pattern.len = length;
  for (const step of hits) pattern.steps[step] = { ...emptyStep(), on: true };
  return pattern;
};

describe("the tides of the weather", () => {
  it("let a weather swell from nothing to all of it and ebb again, over as many bars as the tide is long", () => {
    expect(tideShare(0, 8)).toBe(0);
    expect(tideShare(4 * BAR, 8)).toBeCloseTo(1);
    expect(tideShare(2 * BAR, 8)).toBeCloseTo(0.5);
    expect(tideShare(8 * BAR, 8)).toBeCloseTo(0);
    expect(tideShare(10 * BAR, 8)).toBeCloseTo(0.5);
    // Without a tide the weather is simply there.
    expect([tideShare(0, 0), tideShare(77, 0)]).toEqual([1, 1]);
    expect(TIDES).toContain(12);
    expect(TIDES).toContain(20);
  });

  it("scale what lies on a step, each kind of weather by its own tide", () => {
    const scene = factoryProject().scenes[0]!;
    scene.weather[0]![2]![3] = WEATHER_MAX;
    scene.weather[3]![2]![3] = WEATHER_MAX;
    expect(weatherAt(scene, 0, 2, 3, 40)).toBe(1);
    scene.tide = [4, 0, 0, 0, 0, 0];
    expect(weatherAt(scene, 0, 2, 3, 0)).toBe(0);
    expect(weatherAt(scene, 0, 2, 3, 2 * BAR)).toBeCloseTo(1);
    expect(weatherAt(scene, 0, 2, 3, BAR)).toBeCloseTo(0.5);
    // The rain has no tide.
    expect(weatherAt(scene, 3, 2, 3, 0)).toBe(1);
  });

  it("are taken from a claim only where they are a length a tide can have, and come back from a link", () => {
    expect(cleanTide([8, 0, 12, 7, "4", 64])).toEqual([8, 0, 12, 0, 0, 64]);
    expect([cleanTide([0, 0, 0]), cleanTide("8"), cleanTide(undefined), cleanTide([5, 3])]).toEqual([undefined, undefined, undefined, undefined]);
    const project = factoryProject();
    const scene = project.scenes[0]!;
    expect((pack(project).c[0] as { e?: unknown }).e).toBeUndefined();
    scene.weather[2]![4]![0] = 9;
    scene.tide = [0, 0, 20, 0, 0, 0];
    expect((pack(project).c[0] as { e?: unknown }).e).toEqual([0, 0, 20, 0, 0, 0]);
    expect(unpack(JSON.parse(JSON.stringify(pack(project)))).scenes[0]?.tide).toEqual([0, 0, 20, 0, 0, 0]);
    // A scene without tides has no such list at all.
    delete scene.tide;
    expect("tide" in (unpack(JSON.parse(JSON.stringify(pack(project)))).scenes[0] ?? {})).toBe(false);
  });
});

describe("rings of unequal length", () => {
  it("are together again after the smallest number of steps all their lengths go into", () => {
    expect(meetSteps([16, 12])).toBe(48);
    expect(meetSteps([16, 5])).toBe(80);
    expect(meetSteps([16, 5, 3])).toBe(240);
    expect(meetSteps([4, 5])).toBe(20);
    // Where every length goes into the longest there is nothing to wait for.
    expect([meetSteps([16, 16]), meetSteps([16, 32, 8]), meetSteps([16]), meetSteps([])]).toEqual([null, null, null, null]);
    // Only rings that have hits count.
    expect(meeting([ring(16, [0, 4]), ring(12, [2]), ring(7, [])])).toBe(48);
    expect(meeting([ring(16, [0]), ring(12, [])])).toBeNull();
    // Both Kreisels one can start with have a ring of twelve steps among their sixteens: together again every three bars.
    expect([meeting(factoryProject().scenes[0]!.patterns), meeting(technoProject().scenes[0]!.patterns)]).toEqual([48, 48]);
  });

  it("can begin together again every eight bars, and a link says so", () => {
    const project = factoryProject();
    expect(project.align).toBeUndefined();
    expect(pack(project).a).toBeUndefined();
    project.align = true;
    expect(pack(project).a).toBe(1);
    expect(unpack(JSON.parse(JSON.stringify(pack(project)))).align).toBe(true);
    delete project.align;
    expect("align" in unpack(JSON.parse(JSON.stringify(pack(project))))).toBe(false);
  });
});

describe("how far a ring lies behind the kick", () => {
  const kick = ring(16, [0, 4, 8, 12]);

  it("is how long ago the kick last struck, for most of the ring's hits", () => {
    expect(behindKick(kick, ring(16, [2, 6, 10, 14]))).toBe(2);
    expect(behindKick(kick, ring(16, [4, 12]))).toBe(0);
    expect(behindKick(kick, ring(16, [3, 7, 11, 15]))).toBe(3);
    // A ring longer than the kick's is read against the kick's rounds.
    expect(behindKick(kick, ring(32, [2, 18]))).toBe(2);
    // Before the kick's first strike of a round: counted from its last of the round before.
    expect(behindKick(ring(16, [4, 12]), ring(16, [0, 8]))).toBe(4);
  });

  it("says nothing where the hits lie this way and that, or where one of the two is silent", () => {
    expect(behindKick(kick, ring(16, [0, 1, 2, 3]))).toBeNull();
    expect(behindKick(kick, ring(16, []))).toBeNull();
    expect(behindKick(ring(16, []), ring(16, [2]))).toBeNull();
  });
});
