import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, packPiece, unpackPiece } from "../src/codec";
import { BAR, BUILD_BIG, BUILD_MEDIUM, BUILD_NONE, BUILD_SIZES, BUILD_SMALL, technoPiece, technoProject, TENSION_MAX, TECHNO_ORDER, type Build, type Piece } from "../src/model";
import { seeded } from "../src/patterns";
import { buildAt, buildFor, buildOfAll, clearBuild, describeBuild, dicePiece, dropsOf, gapSteps, isDrop, ownBuild, planBar, resizePiece, rollHits, rotatePiece, sameBuild, setBuild, setKick, setRoster, ROSTER, shareBuild, sizeOf, soundBuild, soundPiece, tidyPiece } from "../src/piece";

/** A piece that is low for `low` bars and then at the top: a drop lands in bar `low`. */
function step(low: number, bars = 32): Piece {
  const tension = Array.from({ length: bars }, (_, bar) => (bar < low ? 10 : TENSION_MAX));
  return { on: true, tension, scenes: tension.map(() => 0), order: [...TECHNO_ORDER] };
}

describe("the drops of a piece", () => {
  it("are the bars much higher than the one before, and the bars in which the kick comes back", () => {
    const start = technoPiece();
    expect(dropsOf(start)).toEqual([16, 64]);
    expect([15, 16, 17, 63, 64].map((bar) => isDrop(start, bar))).toEqual([false, true, false, false, true]);
    // The piece is a ring: a line that ends low and begins high lands in its first bar.
    const turn = step(8, 16);
    rotatePiece(turn, 8);
    expect(dropsOf(turn)).toEqual([0]);
    expect(dropsOf(step(0, 16))).toEqual([]);
  });

  it("have the small build-up unless told otherwise, and each can have one of its own", () => {
    const start = technoPiece();
    expect(buildOfAll(start)).toEqual(BUILD_SMALL);
    expect([buildFor(start, 16), buildFor(start, 64)]).toEqual([BUILD_SMALL, BUILD_BIG]);
    expect([ownBuild(start, 16), ownBuild(start, 64)]).toEqual([null, BUILD_BIG]);
    // One for all: the drop with its own keeps it.
    setBuild(start, null, BUILD_MEDIUM);
    expect([buildFor(start, 16), buildFor(start, 64)]).toEqual([BUILD_MEDIUM, BUILD_BIG]);
    // A drop whose own is that of all has none.
    setBuild(start, 64, BUILD_MEDIUM);
    expect(start.drops).toBeUndefined();
    setBuild(start, 16, { ...BUILD_MEDIUM, late: true });
    expect(start.drops).toEqual([{ bar: 16, build: { ...BUILD_MEDIUM, late: true } }]);
    // "Für alle Drops übernehmen", and "Wieder wie alle Drops".
    shareBuild(start, 16);
    expect([start.build, start.drops]).toEqual([{ ...BUILD_MEDIUM, late: true }, undefined]);
    setBuild(start, 64, BUILD_BIG);
    setBuild(start, 16, BUILD_NONE);
    expect(start.drops).toHaveLength(2);
    clearBuild(start, 64);
    expect(start.drops).toEqual([{ bar: 16, build: BUILD_NONE }]);
    clearBuild(start, null);
    expect(start.drops).toBeUndefined();
    // What is set is a copy: the ready-made sizes stay what they are.
    setBuild(start, 64, BUILD_BIG);
    (ownBuild(start, 64) as Build).roll = false;
    expect(BUILD_BIG.roll).toBe(true);
  });

  it("knows a build-up's size, and says in words what it is made of", () => {
    expect((Object.keys(BUILD_SIZES) as (keyof typeof BUILD_SIZES)[]).map((size) => sizeOf(BUILD_SIZES[size]))).toEqual(["keiner", "klein", "mittel", "gross"]);
    expect(sizeOf({ ...BUILD_BIG, gap: 2 })).toBeNull();
    expect(sameBuild(BUILD_BIG, { ...BUILD_BIG })).toBe(true);
    expect(describeBuild(BUILD_NONE)).toBe("kein Build-up");
    expect(describeBuild(BUILD_SMALL)).toBe("Build-up klein, 1 Takt: Riser");
    expect(describeBuild(BUILD_MEDIUM)).toBe("Build-up mittel, 4 Takte: Riser, Roll, Tiefen raus");
    expect(describeBuild(BUILD_BIG)).toBe("Build-up groß, 8 Takte: Riser mit Ton, Roll, Tiefen raus, Hall-Wolke, leiser, Lücke ein Schlag");
    expect(describeBuild({ ...BUILD_SMALL, riser: 0, bars: 2, kick: true, hat: true, gap: 4, late: true })).toBe("Build-up eigen, 2 Takte: letzter Takt ohne Kick, letzter Takt ohne Hi-Hat, Lücke ein Takt, später Drop");
    expect(describeBuild({ ...BUILD_SMALL, riser: 0 })).toBe("Build-up eigen, 1 Takt: nur der Crash");
  });

  it("takes a claim for a build-up only as far as it plainly is one", () => {
    expect(soundBuild(BUILD_BIG)).toEqual(BUILD_BIG);
    expect(soundBuild({ bars: 4, riser: 7, roll: 1, lows: "ja", gap: 3, late: true })).toEqual({ ...BUILD_NONE, bars: 4, late: true });
    expect([soundBuild(null), soundBuild("groß"), soundBuild({ bars: 3 }), soundBuild({})]).toEqual([null, null, null, null]);
    // No build-up has no parts.
    expect(soundBuild({ ...BUILD_BIG, bars: 0 })).toEqual(BUILD_NONE);
  });
});

describe("the bars of a build-up", () => {
  it("are the bars before the drop, as many as the build-up is long", () => {
    const start = technoPiece();
    expect(buildAt(start, 14)).toBeNull();
    expect(buildAt(start, 15)).toEqual({ drop: 16, at: 0, kit: BUILD_SMALL });
    expect(buildAt(start, 16)).toBeNull();
    expect(buildAt(start, 55)).toBeNull();
    expect(Array.from({ length: 8 }, (_, index) => buildAt(start, 56 + index)?.at)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(buildAt(start, 60)?.drop).toBe(64);
    // The plan of a bar says where it stands, and whether a drop lands in it.
    expect(planBar(start, 56)).toMatchObject({ rise: false, roll: true, drop: null, build: { drop: 64, at: 0 } });
    expect(planBar(start, 63)).toMatchObject({ rise: true, roll: true, drop: null, build: { drop: 64, at: 7 } });
    expect(planBar(start, 64)).toMatchObject({ build: null, drop: BUILD_BIG, roll: false });
    expect(planBar(start, 16)).toMatchObject({ build: null, drop: BUILD_SMALL });
    expect(planBar(start, 15)).toMatchObject({ rise: true, roll: false });
    // No build-up at all: the drop is still a drop.
    setBuild(start, 16, BUILD_NONE);
    expect(planBar(start, 15)).toMatchObject({ rise: true, build: null });
    expect(planBar(start, 16).drop).toEqual(BUILD_NONE);
  });

  it("reach back only to the drop before: right after it a long one begins in its middle", () => {
    // Drops in bar 8 and in bar 12.
    const tension = Array.from({ length: 32 }, (_, bar) => (bar < 8 ? 4 : bar < 12 ? 16 : TENSION_MAX));
    const two: Piece = { on: true, tension, scenes: tension.map(() => 0), order: [...TECHNO_ORDER] };
    expect(dropsOf(two)).toEqual([8, 12]);
    setBuild(two, 12, BUILD_BIG);
    expect([4, 5, 6].map((bar) => buildAt(two, bar))).toEqual([null, null, null]);
    expect(buildAt(two, 7)).toMatchObject({ drop: 8, at: 0, kit: BUILD_SMALL });
    expect([8, 9, 10, 11].map((bar) => buildAt(two, bar)?.at)).toEqual([4, 5, 6, 7]);
    expect(planBar(two, 8)).toMatchObject({ drop: BUILD_SMALL, build: { drop: 12, at: 4 } });
    // A piece shorter than its build-up plays the end of it.
    const short = step(2, 4);
    setBuild(short, null, BUILD_BIG);
    expect([2, 3, 0, 1].map((bar) => buildAt(short, bar)?.at)).toEqual([4, 5, 6, 7]);
  });

  it("leave kick and hi-hat out of the last bar only, and play no roll on a snare that is laid out", () => {
    const line = step(16);
    setBuild(line, null, { ...BUILD_MEDIUM, kick: true, hat: true });
    expect([12, 13, 14, 15].map((bar) => [planBar(line, bar).gates[0]! > 0, planBar(line, bar).gates[2]! > 0])).toEqual([[true, true], [true, true], [true, true], [false, false]]);
    expect([11, 12, 15, 16].map((bar) => planBar(line, bar).roll)).toEqual([false, true, true, false]);
    setRoster(line, 1, 8, 16, ROSTER.rests);
    expect([12, 15].map((bar) => planBar(line, bar).roll)).toEqual([false, false]);
  });
});

describe("the roll", () => {
  const places = (of: number, gap = 0): number[] => Array.from({ length: of }, (_, at) => rollHits(at, of, gap).map((hit) => at * BAR + hit.step)).flat();

  it("of a long build-up plays quarters, eighths, sixteenths and at the very end thirty-seconds", () => {
    const eight = places(8);
    // Quarters through the first four bars, eighths through the next two.
    expect(eight.filter((place) => place < 64)).toEqual(Array.from({ length: 16 }, (_, index) => index * 4));
    expect(eight.filter((place) => place >= 64 && place < 96)).toEqual(Array.from({ length: 16 }, (_, index) => 64 + index * 2));
    // Sixteenths for a bar and a half, thirty-seconds through the last half bar.
    expect(eight.filter((place) => place >= 96 && place < 120)).toEqual(Array.from({ length: 24 }, (_, index) => 96 + index));
    expect(eight.filter((place) => place >= 120)).toEqual(Array.from({ length: 16 }, (_, index) => 120 + index / 2));
    const four = places(4);
    expect(four.filter((place) => place >= 60)).toEqual(Array.from({ length: 8 }, (_, index) => 60 + index / 2));
    expect(four.filter((place) => place < 32)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
  });

  it("gets louder all the way, from half as loud as a hit to well above one", () => {
    for (const of of [1, 2, 4, 8]) {
      const levels = Array.from({ length: of }, (_, at) => rollHits(at, of).map((hit) => hit.level)).flat();
      expect(levels[0]).toBe(0.5);
      expect(levels.at(-1)).toBeGreaterThan(1.15);
      expect(Math.max(...levels)).toBeLessThanOrEqual(1.2);
      expect(levels.every((loud, index) => index === 0 || loud >= (levels[index - 1] ?? 0))).toBe(true);
    }
  });

  it("stops where the gap begins, and comes to its thirty-seconds before that", () => {
    expect(gapSteps(BUILD_BIG)).toBe(4);
    expect([gapSteps({ ...BUILD_BIG, gap: 0 }), gapSteps({ ...BUILD_BIG, gap: 2 }), gapSteps({ ...BUILD_BIG, gap: 4 })]).toEqual([0, 8, 16]);
    const big = places(8, 1);
    expect(Math.max(...big)).toBeLessThan(8 * BAR - 4);
    expect(big.filter((place) => place % 1 !== 0).length).toBeGreaterThanOrEqual(6);
    // A short roll just ends there; a whole bar of gap leaves a single bar's roll nothing.
    expect(places(1, 2)).toEqual([0, 2, 4, 6]);
    expect(places(1, 4)).toEqual([]);
    expect(places(2, 4)).toEqual([0, 4, 8, 10, 12, 14]);
  });

  it("of a single bar is the second half of the one through two bars", () => {
    expect(places(1)).toEqual([0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(rollHits(0, 0)).toEqual([]);
    expect(rollHits(1.5, 4)).toEqual([]);
  });
});

describe("build-ups while the line changes", () => {
  it("hang on the bar the drop lands in: where no drop lands any more, the one of all drops applies again", () => {
    // A level line with a break: the drop is the bar in which the kick comes back.
    const flat = step(0, 32);
    setKick(flat, 8, 16, false);
    expect(dropsOf(flat)).toEqual([16]);
    setBuild(flat, 16, BUILD_BIG);
    // The kick plays in the break again: no drop there, and its build-up goes.
    setKick(flat, 8, 16, true);
    expect(dropsOf(flat)).toEqual([]);
    expect(flat.drops).toBeUndefined();
    setKick(flat, 8, 16, false);
    expect(buildFor(flat, 16)).toEqual(BUILD_SMALL);
    // In the techno Kreisel's own piece the tension jumps there as well: the drop stays, and so does its build-up.
    const start = technoPiece();
    setKick(start, 48, 64, true);
    expect(dropsOf(start)).toEqual([16, 64]);
    expect(buildFor(start, 64)).toEqual(BUILD_BIG);
    // Painting the line does not tidy: an entry may wait on a bar without a drop, and says nothing there.
    const line = step(16);
    setBuild(line, 16, BUILD_BIG);
    line.tension[16] = 12;
    expect(buildFor(line, 17)).toEqual(BUILD_SMALL);
    expect(packPiece(line)).toHaveLength(3);
    line.tension[16] = TENSION_MAX;
    expect(buildFor(line, 16)).toEqual(BUILD_BIG);
    tidyPiece(line);
    expect(line.drops).toEqual([{ bar: 16, build: BUILD_BIG }]);
  });

  it("move with their drop when the piece is stretched or turned", () => {
    const start = technoPiece();
    rotatePiece(start, 8);
    expect(dropsOf(start)).toEqual([24, 72]);
    expect(start.drops).toEqual([{ bar: 72, build: BUILD_BIG }]);
    rotatePiece(start, -8);
    resizePiece(start, 224);
    expect(dropsOf(start)).toEqual([32, 128]);
    expect(start.drops).toEqual([{ bar: 128, build: BUILD_BIG }]);
    resizePiece(start, 56);
    expect(dropsOf(start)).toEqual([8, 32]);
    expect(start.drops).toEqual([{ bar: 32, build: BUILD_BIG }]);
    // A turn that carries the drop over the end of the ring.
    rotatePiece(start, 24);
    expect(start.drops).toEqual([{ bar: 0, build: BUILD_BIG }]);
    expect(planBar(start, 55)).toMatchObject({ rise: true, build: { drop: 0, at: 7 } });
  });

  it("are diced with a techno form: the last drop the biggest, the first small", () => {
    for (const seed of [3, 77, 4711, 20_261_123]) {
      const long = step(0, 112);
      setBuild(long, null, BUILD_SMALL);
      long.drops = [{ bar: 5, build: { ...BUILD_BIG } }];
      dicePiece(long, seeded(seed), "techno");
      const drops = dropsOf(long);
      expect(drops.length).toBeGreaterThanOrEqual(2);
      expect(buildFor(long, drops[0]!)).toEqual(BUILD_SMALL);
      expect(buildFor(long, drops.at(-1)!)).toEqual(BUILD_BIG);
      for (const between of drops.slice(1, -1)) expect(buildFor(long, between)).toEqual(BUILD_MEDIUM);
      // A longer form has drops in between.
      const longer = step(0, 256);
      dicePiece(longer, seeded(seed), "techno");
      expect(dropsOf(longer).length).toBeGreaterThanOrEqual(3);
      expect(longer.drops?.map((entry) => sizeOf(entry.build))).toEqual([...dropsOf(longer).slice(1, -1).map(() => "mittel"), "gross"]);
      // Where the sections are eight bars long there is room for the middle one.
      const short = step(0, 48);
      dicePiece(short, seeded(seed), "techno");
      const last = dropsOf(short).at(-1)!;
      expect(short.drops).toEqual([{ bar: last, build: BUILD_MEDIUM }]);
      // Whoever chose a build-up for all drops keeps it; the free dice leave the drops alone.
      setBuild(long, null, BUILD_NONE);
      dicePiece(long, seeded(seed), "techno");
      expect([long.build, long.drops]).toEqual([BUILD_NONE, undefined]);
      const free = step(8, 32);
      setBuild(free, 8, BUILD_BIG);
      dicePiece(free, seeded(seed));
      expect(free.drops).toBeUndefined();
    }
  });
});

describe("build-ups in a link", () => {
  it("come last, cost nothing while every drop has the small one, and come back as they were", async () => {
    const plain = technoPiece();
    delete plain.drops;
    expect(packPiece(plain)).toHaveLength(4);
    const start = technoPiece();
    const packed = packPiece(start);
    expect(packed).toHaveLength(7);
    expect(packed.slice(4, 6)).toEqual([0, []]);
    expect(packed[6]).toHaveLength(3);
    expect((packed[6] as number[])[1]).toBe(64);
    expect(unpackPiece(JSON.parse(JSON.stringify(packed)), 0)).toEqual(start);
    // Every part of a build-up, for all drops and for one.
    const every: Build = { bars: 2, riser: 2, roll: true, lows: true, wash: true, dip: true, kick: true, hat: true, gap: 4, late: true };
    setBuild(start, null, every);
    setBuild(start, 16, { ...BUILD_NONE });
    setBuild(start, 64, { ...BUILD_MEDIUM, gap: 2, riser: 0 });
    expect(unpackPiece(JSON.parse(JSON.stringify(packPiece(start))), 0)).toEqual(start);
    for (const bars of [1, 2, 4, 8]) {
      for (const gap of [0, 1, 2, 4]) {
        for (const riser of [0, 1, 2]) {
          const one = technoPiece();
          setBuild(one, 64, { ...BUILD_NONE, bars, gap, riser, wash: gap === 2, late: riser === 1 });
          expect(unpackPiece(packPiece(one), 0)).toEqual(one);
        }
      }
    }
    // In a whole Kreisel, through a link.
    const project = technoProject();
    setBuild(project.piece, null, BUILD_MEDIUM);
    const back = await decodeLink(await encodeLink(project));
    expect(back.piece).toEqual(project.piece);
    expect(buildFor(back.piece, 64)).toEqual(BUILD_BIG);
  });

  it("takes from a link only what plainly is a build-up, on a bar where a drop lands", () => {
    const start = technoPiece();
    const [on, bars, order, marks] = packPiece(start);
    const read = (kits: unknown): Piece => unpackPiece([on, bars, order, marks, 0, [], kits], 0);
    const small = (packPiece(start)[6] as number[])[0];
    const big = (packPiece(start)[6] as number[])[2];
    expect(read([small, 64, big])).toEqual(start);
    // No drop lands in bar 40; a bar that is no number, a build-up that is none.
    expect(read([small, 40, big]).drops).toBeUndefined();
    expect(read([small, "64", big]).drops).toBeUndefined();
    expect(read([small, 64, -1]).drops).toBeUndefined();
    expect(read([small, 64, 1 << 20]).drops).toBeUndefined();
    expect(read([small, 64, 7]).drops).toBeUndefined();
    expect(read([small, 64.5, big]).drops).toBeUndefined();
    expect(read("groß")).toMatchObject({ noKick: start.noKick });
    expect(read("groß").drops).toBeUndefined();
    expect(read(Array.from({ length: 200 }, () => big)).build).toBeUndefined();
    // The same drop twice: the first one counts.
    expect(read([small, 64, big, 64, small]).drops).toEqual([{ bar: 64, build: BUILD_BIG }]);
    // A link that says what all drops have, and nothing of single ones.
    expect(read([big])).toMatchObject({ build: BUILD_BIG });
    expect(read([big]).drops).toBeUndefined();
    // What `soundPiece` is handed is checked the same way.
    const tension = start.tension;
    const claimed = soundPiece(true, tension, tension.map(() => 0), [...TECHNO_ORDER], 0, { noKick: start.noKick ?? [], build: { bars: 4, roll: true }, drops: [{ bar: 64, build: BUILD_BIG }, { bar: 16 }, null, { bar: 16, build: { bars: 5 } }] });
    expect(claimed.build).toEqual({ ...BUILD_NONE, bars: 4, roll: true });
    expect(claimed.drops).toEqual([{ bar: 64, build: BUILD_BIG }]);
  });
});
