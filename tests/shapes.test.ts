import { describe, expect, it } from "vitest";
import { BUILD_BIG, BUILD_MEDIUM, BUILD_NONE, technoPiece, TENSION_MAX, TECHNO_ORDER, TRACK_INFO, TRACK_KINDS, type Piece } from "../src/model";
import { seeded } from "../src/patterns";
import { buildFor, dicePiece, dropsOf, nextDrop, protocol, protocolLines, setBuild, setRoster, shapeLine, SHAPES, SHAPE_HINTS, SHAPE_NAMES, STEEP, ROSTER } from "../src/piece";

const blank = (bars: number): Piece => ({ on: true, tension: Array.from({ length: bars }, () => 0), scenes: Array.from({ length: bars }, () => 0), order: [...TECHNO_ORDER] });
const names = TRACK_KINDS.map((kind) => TRACK_INFO[kind].name);
const SEEDS = [1, 42, 4711, 20_261_124];
const share = (piece: Piece, bar: number): number => (piece.tension[bar] ?? 0) / TENSION_MAX;

describe("the shapes the dice can give a piece", () => {
  it("have a name and a word on what they are, and fill a piece of any length", () => {
    expect(SHAPES).toEqual(["plateau", "zwei", "wellen", "lang"]);
    for (const shape of SHAPES) {
      expect(SHAPE_NAMES[shape].length).toBeGreaterThan(3);
      expect(SHAPE_HINTS[shape]).toContain(SHAPE_NAMES[shape]);
      for (const count of [4, 8, 16, 30, 32, 64, 112, 256]) {
        const line = shapeLine(shape, count, seeded(7));
        expect(line.tension).toHaveLength(count);
        expect(line.noKick).toHaveLength(count);
        expect(line.tension.every((tension) => Number.isInteger(tension) && tension >= 0 && tension <= TENSION_MAX)).toBe(true);
      }
    }
  });

  it("Plateau: a long level that takes a small step up every sixteen bars, with no break and no drop", () => {
    for (const seed of SEEDS) {
      const piece = blank(112);
      dicePiece(piece, seeded(seed), "techno", "plateau");
      expect(piece.noKick).toBeUndefined();
      expect(dropsOf(piece)).toEqual([]);
      // Level within every sixteen bars, and never lower in the next.
      for (let bar = 1; bar < 112; bar += 1) {
        const step = share(piece, bar) - share(piece, bar - 1);
        if (bar % 16 === 0) {
          expect(step).toBeGreaterThanOrEqual(0);
          expect(step).toBeLessThan(STEEP / 2);
        } else {
          expect(step).toBe(0);
        }
      }
      expect(share(piece, 0)).toBeGreaterThan(0.45);
      expect(share(piece, 111)).toBeGreaterThan(share(piece, 0));
    }
    // A short piece steps every eight bars.
    const short = blank(32);
    dicePiece(short, seeded(3), "frei", "plateau");
    expect(new Set(short.tension).size).toBeGreaterThan(1);
    expect(short.tension[7]).toBe(short.tension[0]);
  });

  it("Long climb: one climb through the whole piece, at the top for its last bars", () => {
    for (const seed of SEEDS) {
      const piece = blank(64);
      dicePiece(piece, seeded(seed), "techno", "lang");
      expect(piece.tension.every((tension, bar) => bar === 0 || tension >= (piece.tension[bar - 1] ?? 0))).toBe(true);
      expect(share(piece, 0)).toBeLessThan(0.2);
      expect(piece.tension.slice(-8).every((tension) => tension === TENSION_MAX)).toBe(true);
      expect(dropsOf(piece)).toEqual([]);
      expect(piece.noKick).toBeUndefined();
    }
  });

  it("Waves: lifted, lowered and lifted again, every wave a little higher, each arriving at once", () => {
    for (const seed of SEEDS) {
      const piece = blank(112);
      dicePiece(piece, seeded(seed), "techno", "wellen");
      const drops = dropsOf(piece);
      // Sixteen bars of intro, then a wave every thirty-two: three or more of them arrive as drops.
      expect(drops.length).toBeGreaterThanOrEqual(3);
      expect(drops[0]).toBe(16);
      const tops = drops.map((bar) => share(piece, bar));
      expect(tops.every((top, index) => index === 0 || top >= (tops[index - 1] ?? 0))).toBe(true);
      expect(tops.at(-1)).toBeGreaterThan(tops[0] ?? 1);
      // Between two waves the line sinks bar by bar, never in one step.
      for (let bar = 17; bar < 112; bar += 1) expect(share(piece, bar - 1) - share(piece, bar)).toBeLessThan(STEEP);
      expect(piece.noKick).toBeUndefined();
    }
  });

  it("Two drops: two breaks, a drop after each, the second bigger and late", () => {
    for (const seed of SEEDS) {
      for (const count of [64, 112, 200]) {
        const piece = blank(count);
        dicePiece(piece, seeded(seed), "techno", "zwei");
        // Two stretches without the kick, the second the longer one.
        const breaks: [number, number][] = [];
        piece.noKick?.forEach((out, bar) => {
          if (!out) return;
          const last = breaks.at(-1);
          if (last && last[1] === bar) last[1] = bar + 1;
          else breaks.push([bar, bar + 1]);
        });
        expect(breaks).toHaveLength(2);
        const [short, long] = breaks as [[number, number], [number, number]];
        expect(long[1] - long[0]).toBeGreaterThanOrEqual(short[1] - short[0]);
        // A drop lands where each break ends: the first with the middle build-up, the second with the big one, late.
        expect(dropsOf(piece)).toEqual(expect.arrayContaining([short[1], long[1]]));
        expect(buildFor(piece, short[1])).toEqual(BUILD_MEDIUM);
        expect(buildFor(piece, long[1])).toEqual({ ...BUILD_BIG, late: true });
        // The section after the second drop is the fullest of the piece.
        expect(piece.tension[long[1]]).toBe(TENSION_MAX);
        expect(share(piece, short[1])).toBeLessThan(1);
        expect(share(piece, count - 1)).toBeLessThan(0.2);
      }
    }
    // Whoever chose a build-up for all drops keeps it.
    const set = blank(112);
    setBuild(set, null, BUILD_NONE);
    dicePiece(set, seeded(5), "techno", "zwei");
    expect([set.build, set.drops]).toEqual([BUILD_NONE, undefined]);
    // A piece too short for two breaks gets waves instead.
    const tiny = blank(16);
    dicePiece(tiny, seeded(5), "techno", "zwei");
    expect(tiny.noKick).toBeUndefined();
  });

  it("go with what belonged to the old line, like any dice", () => {
    const piece = technoPiece();
    setRoster(piece, 2, 64, 72, ROSTER.rests);
    piece.marks = [{ bar: 5, fx: 4 }];
    dicePiece(piece, seeded(9), "techno", "lang");
    expect([piece.roster, piece.marks, piece.drops, piece.noKick]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("the next drop", () => {
  it("is so many bars away, going round the ring if need be", () => {
    const piece = technoPiece();
    expect(nextDrop(piece, 0)).toBe(16);
    expect(nextDrop(piece, 15)).toBe(1);
    expect(nextDrop(piece, 16)).toBe(48);
    expect(nextDrop(piece, 63)).toBe(1);
    expect(nextDrop(piece, 64)).toBe(64);
    expect(nextDrop(piece, 111)).toBe(17);
    const flat = blank(16);
    expect(nextDrop(flat, 3)).toBeNull();
  });
});

describe("the piece written down", () => {
  it("says phrase by phrase who plays, and where breaks, build-ups and drops are", () => {
    const notes = protocol(technoPiece());
    expect(notes).toHaveLength(14);
    expect(notes[0]).toMatchObject({ from: 0, to: 8, break: false, build: false, drops: [] });
    // The kick plays from the first bar; the melody not before the full sections.
    expect([notes[0]!.rings[0], notes[0]!.rings[6], notes[4]!.rings[6]]).toEqual([2, 0, 2]);
    expect(notes[2]).toMatchObject({ drops: [16] });
    expect(notes[6]).toMatchObject({ break: true, build: false });
    expect(notes[7]).toMatchObject({ break: true, build: true, drops: [] });
    expect(notes[8]).toMatchObject({ break: false, drops: [64] });
    expect(notes[6]!.rings[0]).toBe(0);
    const lines = protocolLines(technoPiece(), names);
    expect(lines[0]).toBe("Bars 1–8: Kick, Snare (partly), Hi-Hat (partly)");
    expect(lines[6]).toBe("Bars 49–56: Snare, Hi-Hat, Drum, Bass · Break");
    expect(lines[4]).toBe("Bars 33–40: all");
    expect(lines[7]).toBe("Bars 57–64: Snare, Hi-Hat, Drum, Bass, Chords (partly) · Break · Build-up");
    expect(lines[8]).toBe("Bars 65–72: all · Drop in bar 65");
    // A piece that is no multiple of eight ends with a shorter phrase; one without tension has nobody playing.
    expect(protocolLines(blank(12), names)).toEqual(["Bars 1–8: nobody", "Bars 9–12: nobody"]);
  });
});
