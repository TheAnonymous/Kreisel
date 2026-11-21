import { describe, expect, it } from "vitest";
import { ACID_GATE, biteOf, CHARGE_MAX, charged, cleanAcid, firstAcid, lenToTie, nextHit, noteSeconds, resonanceDb, restHz, slidesInto, takesAcid, tiesInto } from "../src/acid";
import { decodeLink, encodeLink, pack, unpack } from "../src/codec";
import { ACID_SOUND, emptyPattern, factoryProject, stepAt, technoProject, TRACK_COUNT, type Pattern } from "../src/model";
import { LAST_SOUND } from "../src/sounds/index";

/** A step at 150 beats a minute. */
const STEP = 0.1;

function line(length: number, notes: readonly (readonly [index: number, pitch: number, len?: number])[]): Pattern {
  const pattern = emptyPattern(length);
  for (const [index, pitch, len = 1] of notes) Object.assign(stepAt(pattern, index), { on: true, pitch, len });
  return pattern;
}

describe("how long the machine holds a note", () => {
  it("plays a plain note for little more than half a step, and a longer one that much into its last step", () => {
    expect(noteSeconds(ACID_SOUND, 1, STEP)).toBeCloseTo(ACID_GATE * STEP);
    expect(noteSeconds(ACID_SOUND, 3, STEP)).toBeCloseTo((2 + ACID_GATE) * STEP);
    // Every other sound holds a note for nearly all of its steps, as ever.
    expect(noteSeconds(2, 1, STEP)).toBeCloseTo(0.92 * STEP);
    expect(noteSeconds(2, 4, STEP)).toBeCloseTo(4 * 0.92 * STEP);
  });

  it("ties a note to the next only where it is held into it", () => {
    // Two notes side by side are two notes; held one step longer, the first reaches into the second.
    expect(tiesInto(ACID_SOUND, 1, 1, STEP)).toBe(false);
    expect(tiesInto(ACID_SOUND, 2, 1, STEP)).toBe(true);
    expect(tiesInto(ACID_SOUND, 3, 3, STEP)).toBe(false);
    expect(tiesInto(ACID_SOUND, lenToTie(3), 3, STEP)).toBe(true);
    // That holds at any tempo.
    for (const bpm of [60, 112, 150, 200]) {
      expect(tiesInto(ACID_SOUND, 1, 1, 15 / bpm)).toBe(false);
      expect(tiesInto(ACID_SOUND, 2, 1, 15 / bpm)).toBe(true);
    }
    // The older bass sounds tie notes side by side once the tempo is fast enough: that is left as it was.
    expect(tiesInto(2, 1, 1, STEP)).toBe(true);
    expect(tiesInto(2, 1, 1, 15 / 60)).toBe(false);
  });

  it("finds the next hit around the ring", () => {
    const pattern = line(16, [[0, 7], [3, 14], [15, 8]]);
    expect(nextHit(pattern, 0)).toEqual({ index: 3, distance: 3 });
    expect(nextHit(pattern, 3)).toEqual({ index: 15, distance: 12 });
    expect(nextHit(pattern, 15)).toEqual({ index: 0, distance: 1 });
    expect(nextHit(line(16, [[4, 0]]), 4)).toBeNull();
  });

  it("slides where a note is held into one of another pitch, also over the bar line", () => {
    const pattern = line(16, [[0, 7], [1, 7], [3, 14, 2], [4, 7], [6, 7, 2], [7, 7], [15, 8, 2]]);
    const sliding = [0, 1, 3, 4, 6, 7, 15].filter((index) => slidesInto(pattern, index, ACID_SOUND, STEP));
    // 3 into 4 and 15 into 0. 6 is held into 7 too, but that is the same note: one long note, no slide.
    expect(sliding).toEqual([3, 15]);
    expect(slidesInto(pattern, 2, ACID_SOUND, STEP)).toBe(false);
    // A roll is struck every time and slides nowhere.
    stepAt(pattern, 3).ratchet = 2;
    expect(slidesInto(pattern, 3, ACID_SOUND, STEP)).toBe(false);
  });
});

describe("the machine's filter", () => {
  it("rests lower or higher with the pad from left to right, and rings more from bottom to top", () => {
    expect(restHz(0)).toBeCloseTo(90);
    expect(restHz(1)).toBeCloseTo(2600);
    for (let x = 0; x < 1; x += 0.1) expect(restHz(x + 0.1)).toBeGreaterThan(restHz(x));
    expect(resonanceDb(0)).toBe(0);
    expect(resonanceDb(1)).toBeCloseTo(26);
    for (let y = 0; y < 1; y += 0.1) expect(resonanceDb(y + 0.1)).toBeGreaterThan(resonanceDb(y));
    expect([restHz(-3), restHz(9), resonanceDb(9)]).toEqual([restHz(0), restHz(1), resonanceDb(1)]);
  });

  it("is opened as far as Biss says and falls as slowly as Dauer says", () => {
    const soft = biteOf({ bite: 0, decay: 0, square: false }, false, 0, 0.5);
    const hard = biteOf({ bite: 1, decay: 1, square: false }, false, 0, 0.5);
    expect(soft).toEqual({ open: 1, seconds: 0.05, loud: 1 });
    expect(hard.open).toBeCloseTo(10);
    expect(hard.seconds).toBeCloseTo(0.6);
    expect(hard.loud).toBe(1);
  });

  it("makes an accent louder, shorter and harder, and harder still the more the filter rings", () => {
    const acid = { bite: 0.6, decay: 0.8, square: false };
    const plain = biteOf(acid, false, 0, 0.7);
    const accent = biteOf(acid, true, 0, 0.7);
    expect(accent.loud).toBeGreaterThan(plain.loud);
    expect(accent.seconds).toBeLessThan(plain.seconds);
    expect(accent.seconds).toBe(biteOf({ ...acid, decay: 0 }, true, 0, 0.7).seconds);
    expect(accent.open).toBeGreaterThan(plain.open);
    // With charge left by the accents before it, it opens further; a filter that does not ring makes less of that.
    expect(biteOf(acid, true, 2, 0.7).open).toBeGreaterThan(accent.open);
    expect(biteOf(acid, true, 2, 1).open).toBeGreaterThan(biteOf(acid, true, 2, 0).open);
  });

  it("lets accents that follow closely push one another up, to a limit, and forgets them after a pause", () => {
    const first = charged(0, 10);
    expect(first).toBe(1);
    const second = charged(first, 0.1);
    const third = charged(second, 0.1);
    expect(second).toBeGreaterThan(1.5);
    expect(third).toBeGreaterThan(second);
    expect(charged(third, 0.1)).toBeLessThanOrEqual(CHARGE_MAX);
    expect(charged(CHARGE_MAX, 0)).toBe(CHARGE_MAX);
    // Two seconds later next to nothing is left of them.
    expect(charged(third, 2)).toBeLessThan(1.02);
  });
});

describe("a machine in a Kreisel", () => {
  it("is the first number after the palette's sounds, and only the bass and the melody can have one", () => {
    expect(ACID_SOUND).toBe(LAST_SOUND + 1);
    expect(Array.from({ length: TRACK_COUNT }, (_, track) => takesAcid(track))).toEqual([false, false, false, false, true, false, true]);
  });

  it("is put right whatever is claimed of it", () => {
    expect(firstAcid()).toEqual({ bite: 0.6, decay: 0.35, square: false });
    expect(cleanAcid(null)).toEqual(firstAcid());
    expect(cleanAcid({ bite: 7, decay: -2, square: true })).toEqual({ bite: 1, decay: 0, square: true });
    expect(cleanAcid({ bite: Number.NaN })).toEqual(firstAcid());
  });

  it("travels in a link, after the ring's Zerre; a ring without one is packed as before", async () => {
    const project = factoryProject();
    Object.assign(project.tracks[4]!, { sound: ACID_SOUND, acid: { bite: 0.8, decay: 0.2, square: true }, x: 0.4, y: 0.7 });
    const packed = pack(project);
    expect(packed.t[4]).toHaveLength(12);
    expect(packed.t[4]!.slice(7)).toEqual([0, 0, 0, 0, "80.20.1"]);
    expect(packed.t[5]).toHaveLength(7);
    const back = await decodeLink(await encodeLink(project));
    expect([back.tracks[4]!.sound, back.tracks[4]!.acid]).toEqual([ACID_SOUND, { bite: 0.8, decay: 0.2, square: true }]);
    expect(back).toEqual(project);
    // A machine keeps its settings while the ring plays another sound.
    project.tracks[4]!.sound = 2;
    expect((await decodeLink(await encodeLink(project))).tracks[4]).toEqual(project.tracks[4]);
  });

  it("is not believed where it cannot be", () => {
    const data = pack(factoryProject()) as unknown as { t: unknown[][] };
    // The machine's number without a machine, a machine on a ring that cannot have one, and nonsense for its settings.
    data.t[4] = [ACID_SOUND, 0.5, 0.5, 0.7, 0, 0, 0];
    data.t[5] = [ACID_SOUND, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 0, "60.35.0"];
    data.t[6] = [ACID_SOUND, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 0, "viel.zu.viel"];
    const project = unpack(data);
    expect([project.tracks[4]!.sound, project.tracks[4]!.acid]).toEqual([0, null]);
    expect([project.tracks[5]!.sound, project.tracks[5]!.acid]).toEqual([0, null]);
    expect([project.tracks[6]!.sound, project.tracks[6]!.acid]).toEqual([0, null]);
    data.t[6] = [ACID_SOUND, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 0, "999.0.1"];
    expect(unpack(data).tracks[6]).toMatchObject({ sound: ACID_SOUND, acid: { bite: 1, decay: 0, square: true } });
    // A number beyond every sound is read as the ring's first.
    data.t[6] = [ACID_SOUND + 1, 0.5, 0.5, 0.7, 0, 0, 0, 0, 0, 0, 0, "60.35.0"];
    expect(unpack(data).tracks[6]!.sound).toBe(0);
  });

  it("plays the techno Kreisel's acid line, and the Werks-Kreisel has none", async () => {
    const techno = technoProject();
    expect(techno.tracks[4]).toMatchObject({ sound: ACID_SOUND, acid: firstAcid() });
    expect(techno.tracks[6]!.acid).toBeNull();
    expect(await decodeLink(await encodeLink(techno))).toEqual(techno);
    expect(factoryProject().tracks.every((track) => track.acid === null)).toBe(true);
  });
});
