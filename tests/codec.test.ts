import { describe, expect, it } from "vitest";
import { decodeLink, deserialize, encodeLink, pack, packStep, serialize, unpack, unpackStep } from "../src/codec";
import { clone, factoryProject, MAX_NOTE_LENGTH, PITCH_MAX, PITCH_MIN, stepAt, TRACK_COUNT, type Step } from "../src/model";
import { dice, seeded } from "../src/patterns";

describe("steps as numbers", () => {
  it("round-trips every combination", () => {
    for (const vel of [0, 1, 2]) {
      for (const chance of [0, 1, 2, 3]) {
        for (const ratchet of [1, 2, 3, 4]) {
          for (const len of [1, 2, 9, MAX_NOTE_LENGTH]) {
            for (const pitch of [PITCH_MIN, -1, 0, 5, PITCH_MAX]) {
              const step: Step = { on: true, vel, chance, ratchet, len, pitch };
              expect(unpackStep(packStep(step))).toEqual(step);
            }
          }
        }
      }
    }
  });

  it("stores a silent step as zero and survives nonsense", () => {
    expect(packStep({ on: false, vel: 2, chance: 1, ratchet: 3, len: 4, pitch: 7 })).toBe(0);
    expect(unpackStep(0).on).toBe(false);
    expect(unpackStep(-5).on).toBe(false);
    expect(unpackStep(Number.NaN).on).toBe(false);
    expect(unpackStep(2.5).on).toBe(false);
    const wild = unpackStep(0xffff);
    expect(wild.vel).toBeLessThanOrEqual(2);
    expect(wild.pitch).toBeLessThanOrEqual(PITCH_MAX);
  });
});

describe("projects", () => {
  it("round-trips the factory project and a diced one", async () => {
    const project = factoryProject();
    expect(unpack(pack(project))).toEqual(project);
    const busy = clone(project);
    const scene = busy.scenes[0]!;
    scene.patterns = scene.patterns.map((_, track) => dice(track, 12 + track, seeded(track + 1)));
    busy.scenes[3] = clone(scene);
    busy.scene = 3;
    busy.chain = true;
    busy.repeats = 4;
    busy.scale = "lydisch";
    busy.tracks[2]!.mute = true;
    expect(deserialize(serialize(busy))).toEqual(busy);
    expect(await decodeLink(await encodeLink(busy))).toEqual(busy);
  });

  it("makes links short enough to pass around", async () => {
    const project = factoryProject();
    for (let index = 1; index < 8; index += 1) project.scenes[index] = clone(project.scenes[0]!);
    const link = await encodeLink(project);
    expect(link.startsWith("1.")).toBe(true);
    expect(link.length).toBeLessThan(1500);
    expect(link).toMatch(/^[0-9A-Za-z._-]+$/);
  });

  it("clamps what a hostile link claims", () => {
    const data = pack(factoryProject()) as unknown as Record<string, unknown>;
    Object.assign(data, { b: 99_999, s: -4, r: 44, m: "<script>", p: "viel", i: 7, n: 3, t: [[9, 7, -2, 5, "x", null, 1]] });
    const project = unpack(data);
    expect(project.bpm).toBe(200);
    expect(project.swing).toBe(0);
    expect(project.root).toBe(11);
    expect(project.scale).toBe("moll");
    expect(project.pump).toBe(0.3);
    expect(project.scene).toBe(0);
    expect(project.repeats).toBe(1);
    expect(project.tracks).toHaveLength(TRACK_COUNT);
    expect(project.tracks[0]).toEqual({ sound: 0, x: 1, y: 0, level: 1, hall: 0, echo: 0, mute: true, bild: null, body: null, voice: null });
    expect(stepAt(project.scenes[0]!.patterns[0]!, 0).on).toBe(true);
  });

  it("refuses what is not a Kreisel", async () => {
    expect(() => unpack(null)).toThrow();
    expect(() => unpack({ v: 2 })).toThrow();
    expect(() => unpack({ v: 1, c: [] })).toThrow();
    await expect(decodeLink("9.abc")).rejects.toThrow();
    await expect(decodeLink("1.%%%")).rejects.toThrow();
    await expect(decodeLink(`0.${"A".repeat(50_000)}`)).rejects.toThrow();
  });
});
