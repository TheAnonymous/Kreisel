import { describe, expect, it } from "vitest";
import { strokeMoments } from "../src/audio/bild";
import { describeBild, diceBild, guides, heightToHz, hzToHeight, makeStroke, SEMITONE, snapHeight, strokeAt, strokeLevel } from "../src/bild";
import { decodeLink, encodeLink, pack, packBild, unpack, unpackBild } from "../src/codec";
import { factoryProject, HEIGHT_MAX, MAX_STROKE_POINTS, MAX_STROKES, OWN_SOUND, TIME_MAX, TRACK_COUNT, trackInfo, type Stroke } from "../src/model";
import { seeded } from "../src/patterns";

describe("the sheet", () => {
  it("spans nine octaves from 27.5 Hz", () => {
    expect(heightToHz(0)).toBeCloseTo(27.5);
    expect(heightToHz(HEIGHT_MAX)).toBeCloseTo(14_080);
    for (const hz of [55, 220, 440, 3520]) expect(heightToHz(hzToHeight(hz))).toBeCloseTo(hz, 0);
    expect(heightToHz(hzToHeight(440) + SEMITONE) / 440).toBeCloseTo(2 ** (1 / 12), 3);
  });

  it("gives rings that play notes a root line and overtones, drums plain octaves", () => {
    const bass = guides(4);
    expect(bass.find((guide) => guide.root)?.y).toBe(hzToHeight(55));
    expect(bass.map((guide) => Math.round(heightToHz(guide.y)))).toEqual([28, 55, 110, 165, 220, 275, 330, 440]);
    expect(guides(0).some((guide) => guide.root)).toBe(false);
  });

  it("lets tones stick to those lines, and only tones", () => {
    const root = hzToHeight(440);
    expect(snapHeight(6, 0, root + SEMITONE)).toBe(root);
    expect(snapHeight(6, 1, root - SEMITONE * 1.4)).toBe(root);
    expect(snapHeight(6, 0, root + SEMITONE * 3)).toBe(root + SEMITONE * 3);
    expect(snapHeight(6, 2, root + SEMITONE)).toBe(root + SEMITONE);
    expect(snapHeight(0, 0, root + SEMITONE)).toBe(root + SEMITONE);
  });
});

describe("a stroke of the brush", () => {
  it("fades when painted from left to right", () => {
    const stroke = makeStroke(0, 2, [{ t: 0.1, y: 0.5 }, { t: 0.3, y: 0.4 }, { t: 0.6, y: 0.2 }])!;
    expect(stroke.swell).toBe(false);
    expect(stroke.points.filter((_, index) => index % 2 === 0)).toEqual([26, 77, 153]);
    expect(strokeLevel(stroke, 0)).toBe(1);
    expect(strokeLevel(stroke, 1)).toBe(0);
    expect(strokeLevel(stroke, 0.5)).toBeGreaterThan(0.2);
    expect(strokeLevel(stroke, 0.5)).toBeLessThan(0.5);
  });

  it("swells when painted from right to left, and is stored left to right", () => {
    const stroke = makeStroke(2, 1, [{ t: 0.8, y: 0.9 }, { t: 0.5, y: 0.8 }, { t: 0.2, y: 0.7 }])!;
    expect(stroke.swell).toBe(true);
    // The three points lie on one line: two remain, the left one first.
    expect(stroke.points).toEqual([51, Math.round(0.7 * HEIGHT_MAX), 204, Math.round(0.9 * HEIGHT_MAX)]);
    expect(strokeLevel(stroke, 0)).toBe(0);
    expect(strokeLevel(stroke, 1)).toBe(1);
  });

  it("never lets time run backwards: a turn of the hand only changes the pitch", () => {
    const stroke = makeStroke(0, 1, [{ t: 0.2, y: 0.2 }, { t: 0.5, y: 0.5 }, { t: 0.3, y: 0.9 }, { t: 0.7, y: 0.6 }])!;
    const times = stroke.points.filter((_, index) => index % 2 === 0);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(times).toEqual([51, 128, 128, 179]);
  });

  it("thins a wobbly line out and never keeps more points than a picture may hold", () => {
    const straight = makeStroke(0, 1, Array.from({ length: 200 }, (_, index) => ({ t: index / 200, y: 0.5 + (index % 2) * 0.001 })))!;
    expect(straight.points).toHaveLength(4);
    const wild = makeStroke(0, 1, Array.from({ length: 400 }, (_, index) => ({ t: index / 400, y: 0.5 + 0.4 * Math.sin(index * 1.3) })))!;
    expect(wild.points.length / 2).toBeLessThanOrEqual(MAX_STROKE_POINTS);
    expect(wild.points.length / 2).toBeGreaterThan(8);
  });

  it("keeps a dab as one point and snaps a line along the root to two", () => {
    expect(makeStroke(1, 0, [{ t: 0.4, y: 0.4 }])!.points).toEqual([102, Math.round(0.4 * HEIGHT_MAX)]);
    expect(makeStroke(0, 0, [])).toBeNull();
    const root = hzToHeight(55);
    const along = makeStroke(0, 2, [{ t: 0, y: 0.118 }, { t: 0.4, y: 0.105 }, { t: 0.8, y: 0.115 }], (y) => snapHeight(4, 0, y))!;
    expect(along.points).toEqual([0, root, 204, root]);
  });

  it("is found under the eraser", () => {
    const bild = { hold: null, strokes: [makeStroke(0, 1, [{ t: 0.1, y: 0.2 }, { t: 0.9, y: 0.2 }])!, makeStroke(2, 1, [{ t: 0.1, y: 0.8 }, { t: 0.5, y: 0.8 }])!] };
    expect(strokeAt(bild, 0.5, 0.21, 0.04)).toBe(0);
    expect(strokeAt(bild, 0.3, 0.79, 0.04)).toBe(1);
    expect(strokeAt(bild, 0.8, 0.8, 0.04)).toBe(-1);
    expect(strokeAt(bild, 0.5, 0.5, 0.04)).toBe(-1);
  });
});

describe("pictures", () => {
  it("come out of the dice playable, for every ring", () => {
    for (let track = 0; track < TRACK_COUNT; track += 1) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const bild = diceBild(track, seeded(seed * 13 + track));
        expect(bild.strokes.length).toBeGreaterThan(0);
        expect(bild.strokes.length).toBeLessThanOrEqual(MAX_STROKES);
        if (!trackInfo(track).melodic) expect(bild.hold).toBeNull();
        for (const stroke of bild.strokes) {
          const times = stroke.points.filter((_, index) => index % 2 === 0);
          expect([...times].sort((a, b) => a - b)).toEqual(times);
          expect(Math.max(...times)).toBeLessThanOrEqual(TIME_MAX);
          expect(stroke.points.length).toBeGreaterThanOrEqual(2);
        }
        expect(describeBild(bild)).toMatch(/stroke/);
      }
    }
    expect(describeBild(null)).toBe("still empty");
  });

  it("put the root of a ring that plays notes exactly on its line", () => {
    for (const track of [4, 5, 6]) {
      const root = hzToHeight(trackInfo(track).refHz);
      for (let seed = 1; seed <= 10; seed += 1) {
        const onRoot = diceBild(track, seeded(seed)).strokes.some((stroke) => stroke.points[stroke.points.length - 1] === root);
        expect(onRoot, `ring ${track}, seed ${seed}`).toBe(true);
      }
    }
  });

  it("survive packing, in a project and in a link", async () => {
    const project = factoryProject();
    project.tracks.forEach((track, index) => {
      track.bild = diceBild(index, seeded(index + 5));
      track.sound = OWN_SOUND;
    });
    for (const track of project.tracks) expect(unpackBild(packBild(track.bild!))).toEqual(track.bild);
    expect(unpack(pack(project))).toEqual(project);
    const link = await encodeLink(project);
    expect(await decodeLink(link)).toEqual(project);
    expect(link.length).toBeLessThan(2000);
  });

  it("are checked when they come from a link", () => {
    expect(unpackBild(undefined)).toBeNull();
    expect(unpackBild("")).toBeNull();
    expect(unpackBild("%%%")).toBeNull();
    expect(unpackBild("A".repeat(5000))).toBeNull();
    // Claims 200 strokes (twelve follow), each of forty points, with time running backwards and everything out of range.
    const bytes = [1, 250, 200];
    for (let stroke = 0; stroke < 12; stroke += 1) {
      bytes.push(255, 40);
      for (let point = 0; point < 40; point += 1) bytes.push(200 - point, 255, 255);
    }
    const wild = unpackBild(btoa(String.fromCharCode(...bytes)))!;
    expect(wild.strokes).toHaveLength(MAX_STROKES);
    expect(wild.hold).toBe(250);
    for (const stroke of wild.strokes) {
      expect(stroke.kind).toBeLessThanOrEqual(2);
      expect(stroke.size).toBeLessThanOrEqual(2);
      expect(stroke.points.length / 2).toBeLessThanOrEqual(MAX_STROKE_POINTS);
      expect(new Set(stroke.points.filter((_, index) => index % 2 === 0))).toEqual(new Set([200]));
    }
    const project = pack(factoryProject()) as unknown as { t: unknown[][] };
    // A ring cannot play a picture it does not have: it falls back to its first sound.
    project.t[0] = [OWN_SOUND, 0.5, 0.5, 0.8, 0, 0, 0, 42];
    expect(unpack(project).tracks[0]).toMatchObject({ sound: 0, bild: null });
    // An emptied sheet is a picture too (a silent one), and stays the ring's sound.
    project.t[0] = [OWN_SOUND, 0.5, 0.5, 0.8, 0, 0, 0, packBild({ strokes: [], hold: null })];
    expect(unpack(project).tracks[0]).toMatchObject({ sound: OWN_SOUND, bild: { strokes: [], hold: null } });
  });
});

describe("a picture in time", () => {
  const stroke: Stroke = { kind: 0, size: 2, swell: false, points: [0, hzToHeight(440), TIME_MAX, hzToHeight(220)] };

  it("plays a struck stroke straight through, moved to the note", () => {
    const moments = strokeMoments(stroke, 2, null, 0, 0.5);
    expect(moments).toHaveLength(2);
    expect(moments[0]).toMatchObject({ at: 0, level: 1 });
    expect(moments[0]!.hz).toBeCloseTo(220, 0);
    expect(moments[1]!.at).toBeCloseTo(2);
    expect(moments[1]!.hz).toBeCloseTo(110, 0);
    expect(moments[1]!.level).toBe(0);
  });

  it("stands still at the hold for as long as the note lasts, then plays the rest", () => {
    const moments = strokeMoments(stroke, 2, 0.5, 3, 1);
    expect(moments.map((moment) => +moment.at.toFixed(2))).toEqual([0, 1, 4, 5]);
    expect(moments[1]!.hz).toBeCloseTo(moments[2]!.hz);
    expect(moments[1]!.level).toBeCloseTo(moments[2]!.level);
    expect(moments[1]!.hz).toBeCloseTo(Math.sqrt(440 * 220), 0);
    // A stroke that ends before the hold is not stretched.
    const early: Stroke = { ...stroke, points: [0, hzToHeight(440), 60, hzToHeight(440)] };
    expect(strokeMoments(early, 2, 0.5, 3, 1).map((moment) => +moment.at.toFixed(2))).toEqual([0, 0.47]);
  });

  it("gives a dab a short life of its own", () => {
    const dab = strokeMoments({ kind: 2, size: 0, swell: false, points: [100, 30_000] }, 1, null, 0, 1);
    expect(dab).toHaveLength(2);
    expect(dab[1]!.at - dab[0]!.at).toBeGreaterThan(0.015);
    expect(dab[1]!.at - dab[0]!.at).toBeLessThan(0.04);
  });
});
