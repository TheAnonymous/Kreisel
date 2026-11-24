import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, pack, unpack } from "../src/codec";
import { factoryProject, technoProject, TRACK_COUNT } from "../src/model";
import { clip, clipCurve, driveGains, driven, driveTrim, FIRST, pressGains, ringGains, SECOND } from "../src/press";

describe("Drive", () => {
  it("adds a ring's own drive and the sparks over it, up to all there is", () => {
    expect(driven(0, 0)).toBe(0);
    expect(driven(0.3, 0.5)).toBeCloseTo(0.8);
    expect(driven(0.8, 0.5)).toBe(1);
    expect(driven(-1, 2)).toBe(1);
  });

  it("leaves a ring that is not driven to the sparks, as they always were", () => {
    expect(driveGains(0)).toEqual({ dry: 1, push: 1.2, wet: 0 });
    expect(driveGains(1).dry).toBeCloseTo(0.1);
    expect(driveGains(1).push).toBeCloseTo(5);
    expect(driveGains(1).wet).toBeCloseTo(0.27);
    for (const sparks of [0, 0.2, 0.5, 1]) expect(ringGains(0, sparks)).toEqual(driveGains(sparks));
  });

  it("is levelled: turned up through its middle, where a driven ring would get quieter, and down at its end", () => {
    expect(driveTrim(0)).toBe(1);
    expect(driveTrim(0.45)).toBeGreaterThan(1.2);
    expect(driveTrim(1)).toBeLessThan(1);
    // No step anywhere along the control.
    for (let drive = 0; drive < 1; drive += 0.01) expect(Math.abs(driveTrim(drive + 0.01) - driveTrim(drive))).toBeLessThan(0.02);
    const gains = ringGains(0.6, 0);
    expect(gains.dry).toBeCloseTo(driveGains(0.6).dry * driveTrim(0.6));
    expect(gains.wet).toBeCloseTo(driveGains(0.6).wet * driveTrim(0.6));
    expect(gains.push).toBe(driveGains(0.6).push);
  });

  it("travels in a link, after the ring's own sounds; a ring that is not driven is packed as before", async () => {
    const project = factoryProject();
    project.tracks[4]!.drive = 0.4;
    const packed = pack(project);
    expect(packed.t[4]).toHaveLength(11);
    expect(packed.t[4]!.slice(7)).toEqual([0, 0, 0, 40]);
    expect(packed.t[0]).toHaveLength(7);
    expect((await decodeLink(await encodeLink(project))).tracks.map((track) => track.drive)).toEqual([0, 0, 0, 0, 0.4, 0, 0]);
    // With a voice of its own the ring keeps both.
    project.tracks[4]!.voice = { text: "Zer-re", mouth: 0.5, breath: 0.2 };
    const back = await decodeLink(await encodeLink(project));
    expect([back.tracks[4]!.drive, back.tracks[4]!.voice?.text]).toEqual([0.4, "Zer-re"]);
  });

  it("is put right when a link claims nonsense, and is nothing in a link from before", () => {
    const data = pack(factoryProject()) as unknown as Record<string, unknown>;
    expect(unpack(data).tracks.every((track) => track.drive === 0)).toBe(true);
    Object.assign(data, { t: [[0, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 999], [0, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, "viel"], [0, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, -5]] });
    expect(unpack(data).tracks.slice(0, 3).map((track) => track.drive)).toEqual([1, 0, 0]);
  });
});

describe("Pressure", () => {
  it("lets everything pass untouched at rest", () => {
    expect(pressGains(0)).toEqual({ clean: 1, pressed: 0, first: 1, second: 1, mono: false });
  });

  it("fades the clippers in over the first hundredths and from there on only pushes harder", () => {
    expect(pressGains(0.03).clean).toBeCloseTo(0.5);
    expect(pressGains(0.03).pressed).toBeCloseTo(0.5);
    expect(pressGains(0.06).clean).toBe(0);
    expect(pressGains(0.01).mono).toBe(true);
    const full = pressGains(1);
    expect([full.clean, full.pressed, full.mono]).toEqual([0, 1, true]);
    expect(full.first).toBeCloseTo(4);
    expect(full.second).toBeCloseTo(2);
    for (let amount = 0; amount < 1; amount += 0.05) {
      expect(pressGains(amount + 0.05).first).toBeGreaterThan(pressGains(amount).first);
      expect(pressGains(amount + 0.05).second).toBeGreaterThan(pressGains(amount).second);
    }
    expect(pressGains(7)).toEqual(pressGains(1));
  });

  it("clips softly: what is quiet is left alone, nothing passes the top, and the knee is no corner", () => {
    for (const stage of [FIRST, SECOND]) {
      expect(clip(stage.knee / 2, stage.knee, stage.top)).toBe(stage.knee / 2);
      expect(clip(-stage.knee / 2, stage.knee, stage.top)).toBe(-stage.knee / 2);
      expect(clip(100, stage.knee, stage.top)).toBeLessThanOrEqual(stage.top);
      expect(clip(100, stage.knee, stage.top)).toBeGreaterThan(stage.top - 0.001);
      expect(clip(-3, stage.knee, stage.top)).toBe(-clip(3, stage.knee, stage.top));
      // It only ever rises, and just above the knee it still rises as steeply as below it.
      for (let value = 0; value < 4; value += 0.01) expect(clip(value + 0.01, stage.knee, stage.top)).toBeGreaterThanOrEqual(clip(value, stage.knee, stage.top));
      expect((clip(stage.knee + 0.001, stage.knee, stage.top) - stage.knee) / 0.001).toBeCloseTo(1, 2);
    }
  });

  it("draws that as a shaper's curve from −reach to reach", () => {
    const curve = clipCurve(FIRST);
    expect(curve).toHaveLength(4097);
    expect(curve[2048]).toBe(0);
    expect(curve[4096]).toBeCloseTo(clip(FIRST.reach, FIRST.knee, FIRST.top));
    expect(curve[0]).toBeCloseTo(-(curve[4096] ?? 0));
    // An input of 0.25 is a thirty-second of the way from the middle to the end, and is left alone.
    expect(curve[2048 + 64]).toBeCloseTo(0.25);
  });

  it("travels in a link, and is nothing in a link without it", async () => {
    const project = factoryProject();
    expect("u" in pack(project)).toBe(false);
    project.pressure = 0.35;
    expect(pack(project).u).toBe(35);
    expect((await decodeLink(await encodeLink(project))).pressure).toBe(0.35);
    const data = pack(factoryProject()) as unknown as Record<string, unknown>;
    expect(unpack({ ...data, u: 500 }).pressure).toBe(1);
    expect(unpack({ ...data, u: "fest" }).pressure).toBe(0);
  });
});

describe("where a Kreisel starts", () => {
  it("is neither driven nor pressed as the factory Kreisel", () => {
    const werk = factoryProject();
    expect(werk.pressure).toBe(0);
    expect(werk.tracks.map((track) => track.drive)).toEqual(Array.from({ length: TRACK_COUNT }, () => 0));
  });

  it("is driven and pressed as the techno Kreisel; only the kick is left to what is its own", async () => {
    const techno = technoProject();
    expect(techno.pressure).toBe(0.35);
    expect(techno.tracks[0]?.drive).toBe(0);
    for (const track of techno.tracks.slice(1)) expect(track.drive).toBeGreaterThan(0.1);
    expect(await decodeLink(await encodeLink(techno))).toEqual(techno);
  });
});
