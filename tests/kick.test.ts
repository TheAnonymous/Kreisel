import { describe, expect, it } from "vitest";
import { deserialize, packState, serialize } from "../src/codec";
import { KICK_REACH, kickHz } from "../src/kick";
import { factoryProject, type Project } from "../src/model";
import { changedRings } from "../src/relay";

const semitones = (from: number, to: number): number => 12 * Math.log2(to / from);
/** The name of a pitch: 0 = C … 11 = H, and how far off it is. */
const nameOf = (hz: number): { name: number; off: number } => {
  const midi = 69 + 12 * Math.log2(hz / 440);
  const nearest = Math.round(midi);
  return { name: ((nearest % 12) + 12) % 12, off: Math.abs(midi - nearest) };
};
const state = (change: (project: Project) => void = () => undefined): unknown => {
  const project = factoryProject();
  change(project);
  return JSON.parse(JSON.stringify(packState(project)));
};

describe("the kick's place in the key", () => {
  it("lands on the key's root or its fifth, whichever is nearer", () => {
    // In A: A1 is 55 Hz, E1 41.2 Hz, E2 82.4 Hz.
    expect(kickHz(54, 9)).toBeCloseTo(55, 5);
    expect(kickHz(48.5, 9)).toBeCloseTo(55, 5);
    expect(kickHz(44, 9)).toBeCloseTo(41.203, 2);
    expect(kickHz(70, 9)).toBeCloseTo(82.407, 2);
    // In C: G1 is 49 Hz, C2 65.4 Hz.
    expect(kickHz(54, 0)).toBeCloseTo(48.999, 2);
    expect(kickHz(60, 0)).toBeCloseTo(65.406, 2);
  });

  it("is never more than three and a half semitones from where the sound put it, in any key", () => {
    for (let root = 0; root < 12; root += 1) {
      for (let hz = 30; hz < 90; hz *= 1.013) {
        const landed = kickHz(hz, root);
        expect(Math.abs(semitones(hz, landed))).toBeLessThanOrEqual(KICK_REACH + 1e-9);
        const { name, off } = nameOf(landed);
        expect(off).toBeLessThan(1e-6);
        expect([root, (root + 7) % 12]).toContain(name);
      }
    }
  });

  it("stays where it is on a note of the key, and leaves nonsense alone", () => {
    expect(kickHz(55, 9)).toBeCloseTo(55, 9);
    expect(kickHz(0, 9)).toBe(0);
    expect(kickHz(-40, 9)).toBe(-40);
    expect(kickHz(Number.NaN, 9)).toBeNaN();
  });
});

describe("the kick's hardness in the link", () => {
  it("is clean in a fresh Kreisel and costs nothing in the link while it is", () => {
    const project = factoryProject();
    expect(project.hard).toBe(0);
    expect((JSON.parse(serialize(project)) as { w: number[] }).w).toHaveLength(2);
  });

  it("travels with the rumble's character", () => {
    const project = factoryProject();
    project.hard = 0.8;
    project.dirt = 0.6;
    const text = serialize(project);
    expect((JSON.parse(text) as { w: number[] }).w).toEqual([60, 20, 80]);
    const back = deserialize(text);
    expect([back.hard, back.dirt, back.roll]).toEqual([0.8, 0.6, 0.2]);
    expect(deserialize(serialize(back))).toEqual(back);
  });

  it("has a clean kick in a link from before, and keeps what a link claims where it may be", () => {
    const old = JSON.parse(serialize(factoryProject())) as Record<string, unknown>;
    expect(deserialize(JSON.stringify(old)).hard).toBe(0);
    delete old.w;
    expect(deserialize(JSON.stringify(old)).hard).toBe(0);
    old.w = [35, 20, 900];
    expect(deserialize(JSON.stringify(old)).hard).toBe(1);
    old.w = [35, 20, -5];
    expect(deserialize(JSON.stringify(old)).hard).toBe(0);
    old.w = [35, 20, "hart"];
    expect(deserialize(JSON.stringify(old)).hard).toBe(0);
  });

  it("counts as the kick's ring in Pass around", () => {
    expect(changedRings(state(), state((project) => { project.hard = 0.5; }))).toEqual([0]);
    expect(changedRings(state((project) => { project.hard = 0.5; }), state((project) => { project.hard = 0.5; }))).toEqual([]);
  });
});
