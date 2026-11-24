import { describe, expect, it } from "vitest";
import { packPiece, unpackPiece } from "../src/codec";
import { BUILD_BIG, BUILD_NONE, firstPiece, MARK, technoPiece, TENSION_MAX, TECHNO_ORDER, type Piece } from "../src/model";
import { seeded } from "../src/patterns";
import { clearMarks, dicePiece, endsCount, markNames, marksAt, planBar, resizePiece, rotatePiece, setBuild, setEnds, setVary, soundEnds, soundMarks, soundPiece, tidyPiece, toggleMark } from "../src/piece";

const level = (bars: number, tension = TENSION_MAX): Piece => ({ on: true, tension: Array.from({ length: bars }, () => tension), scenes: Array.from({ length: bars }, () => 0), order: [...TECHNO_ORDER] });
const where = (piece: Piece, what: "lastKick" | "crash" | "swell"): number[] => piece.tension.flatMap((_, bar) => (planBar(piece, bar)[what] ? [bar] : []));

describe("the ends of the phrases", () => {
  it("do nothing by themselves unless the piece says so", () => {
    const line = level(32);
    expect([where(line, "lastKick"), where(line, "crash"), where(line, "swell")]).toEqual([[], [], []]);
    expect(endsCount(line)).toBe(0);
    expect(planBar(technoPiece(), 7)).toMatchObject({ lastKick: false, crash: false, swell: false, marks: 0 });
  });

  it("leave the last kick of every phrase out, put a crash on the one every 16 or 32 bars, and let a cymbal swell into the next phrase", () => {
    const line = level(64);
    setEnds(line, { kick: true });
    expect(where(line, "lastKick")).toEqual([7, 15, 23, 31, 39, 47, 55, 63]);
    setEnds(line, { crash: 16 });
    expect(where(line, "crash")).toEqual([0, 16, 32, 48]);
    setEnds(line, { crash: 32 });
    expect(where(line, "crash")).toEqual([0, 32]);
    setEnds(line, { swell: true });
    expect(where(line, "swell")).toEqual([7, 15, 23, 31, 39, 47, 55, 63]);
    expect(line.ends).toEqual({ kick: true, crash: 32, swell: true });
    setVary(line, true);
    expect(endsCount(line)).toBe(4);
    // Switched off again, the piece has none of it.
    setEnds(line, { kick: false, crash: 0, swell: false });
    expect(line.ends).toBeUndefined();
    expect(endsCount(line)).toBe(1);
  });

  it("leave a drop its own crash, and a build-up's riser its own swell", () => {
    // A drop lands in bar 17, with the small build-up (a bar of riser, then a crash).
    const line = level(32);
    for (let bar = 0; bar < 16; bar += 1) line.tension[bar] = 10;
    setEnds(line, { crash: 16, swell: true });
    expect(where(line, "crash")).toEqual([0]);
    expect(where(line, "swell")).toEqual([7, 23, 31]);
    // Without a build-up the drop has no crash of its own, and nothing swells into it either.
    setBuild(line, null, BUILD_NONE);
    expect(where(line, "crash")).toEqual([0, 16]);
    expect(where(line, "swell")).toEqual([7, 15, 23, 31]);
    // A long build-up without a riser leaves the cymbal its place.
    setBuild(line, null, { ...BUILD_BIG, riser: 0 });
    expect(where(line, "swell")).toEqual([7, 15, 23, 31]);
    setBuild(line, null, BUILD_BIG);
    expect(where(line, "swell")).toEqual([7, 23, 31]);
  });

  it("are taken from a claim only as far as it plainly says them", () => {
    expect(soundEnds({ kick: 1, crash: 8, swell: "ja" })).toBeNull();
    expect(soundEnds({ kick: true, crash: 24 })).toEqual({ kick: true, crash: 0, swell: false });
    expect(soundEnds({ crash: 32 })).toEqual({ kick: false, crash: 32, swell: false });
    expect([soundEnds(null), soundEnds([]), soundEnds("an")]).toEqual([null, null, null]);
  });
});

describe("effect marks", () => {
  it("lay one or more of the five live effects on a bar, and take them away again", () => {
    const line = level(16);
    toggleMark(line, 5, MARK.stotter);
    toggleMark(line, 5, MARK.echo);
    toggleMark(line, 2, MARK.dumpf);
    expect(line.marks).toEqual([{ bar: 2, fx: 1 }, { bar: 5, fx: 12 }]);
    expect([marksAt(line, 5), marksAt(line, 2), marksAt(line, 3)]).toEqual([12, 1, 0]);
    expect(markNames(marksAt(line, 5))).toEqual(["Stutter", "Echo"]);
    expect(markNames(31)).toEqual(["Dull", "Thin", "Stutter", "Echo", "Pause"]);
    expect([planBar(line, 5).marks, planBar(line, 6).marks]).toEqual([12, 0]);
    toggleMark(line, 5, MARK.stotter);
    expect(marksAt(line, 5)).toBe(8);
    toggleMark(line, 5, MARK.echo);
    expect(line.marks).toEqual([{ bar: 2, fx: 1 }]);
    clearMarks(line, 2);
    expect(line.marks).toBeUndefined();
    toggleMark(line, 1, MARK.pause);
    toggleMark(line, 9, MARK.duenn);
    clearMarks(line, null);
    expect(line.marks).toBeUndefined();
  });

  it("stay with their bar when the piece is stretched or turned, and go with a line that is diced anew", () => {
    const line = level(16);
    toggleMark(line, 3, MARK.pause);
    toggleMark(line, 15, MARK.echo);
    rotatePiece(line, 2);
    expect(line.marks).toEqual([{ bar: 1, fx: 8 }, { bar: 5, fx: 16 }]);
    resizePiece(line, 32);
    expect(line.marks).toEqual([{ bar: 2, fx: 8 }, { bar: 10, fx: 16 }]);
    resizePiece(line, 8);
    expect(line.marks).toEqual([{ bar: 1, fx: 8 }, { bar: 3, fx: 16 }]);
    // Two marks that meet in a shorter piece: the first stays.
    toggleMark(line, 2, MARK.dumpf);
    resizePiece(line, 4);
    expect(line.marks).toEqual([{ bar: 1, fx: 8 }, { bar: 2, fx: 16 }]);
    dicePiece(line, seeded(5));
    expect(line.marks).toBeUndefined();
    const techno = level(64);
    toggleMark(techno, 9, MARK.stotter);
    dicePiece(techno, seeded(5), "techno");
    expect(techno.marks).toBeUndefined();
  });

  it("are taken from a claim only where they name a bar of the piece and effects that exist", () => {
    expect(soundMarks([{ bar: 3, fx: 4 }, { bar: 3, fx: 8 }, { bar: 99, fx: 1 }, { bar: 1, fx: 0 }, { bar: 2, fx: 32 }, { bar: 0.5, fx: 1 }, { bar: "4", fx: 1 }, null, { bar: 0, fx: 31 }], 16)).toEqual([{ bar: 0, fx: 31 }, { bar: 3, fx: 4 }]);
    expect([soundMarks("alle", 16), soundMarks(null, 16)]).toEqual([[], []]);
    const untidy: Piece = { ...level(8), marks: [{ bar: 12, fx: 1 }], ends: { kick: false, crash: 0, swell: false } };
    tidyPiece(untidy);
    expect([untidy.marks, untidy.ends]).toEqual([undefined, undefined]);
    expect(soundPiece(true, [5, 5, 5, 5], [], [], 0, { ends: { swell: true }, marks: [{ bar: 2, fx: 2 }, { bar: 7, fx: 2 }] })).toMatchObject({ ends: { kick: false, crash: 0, swell: true }, marks: [{ bar: 2, fx: 2 }] });
  });
});

describe("phrase ends and effect marks in a link", () => {
  it("are entries of the piece's eighth part, cost nothing while there are none, and come back as they were", () => {
    const plain = firstPiece();
    setEnds(plain, { kick: true, crash: 32, swell: true });
    toggleMark(plain, 7, MARK.stotter);
    toggleMark(plain, 7, MARK.echo);
    toggleMark(plain, 30, MARK.pause);
    const packed = packPiece(plain);
    expect(packed.slice(3)).toEqual(["", 0, [], [], { e: 1 | 4 | 8, m: [7, 12, 30, 16] }]);
    expect(unpackPiece(JSON.parse(JSON.stringify(packed)), 0)).toEqual(plain);
    for (const crash of [0, 16, 32]) {
      const one = technoPiece();
      setEnds(one, { crash, swell: crash === 0 });
      expect(unpackPiece(JSON.parse(JSON.stringify(packPiece(one))), 0)).toEqual(one);
    }
    expect(packPiece(technoPiece())).toHaveLength(7);
    // What a link claims beyond that is not taken.
    const seven = packPiece(technoPiece());
    for (const claim of [{ e: 0 }, { e: 16 }, { e: "1" }, { m: [3] }, { m: "3,4" }, { m: [999, 1] }, { m: [3, 64] }]) expect(unpackPiece([...seven, claim], 0)).toEqual(technoPiece());
    expect(unpackPiece([...seven, { e: 2 | 4 }], 0).ends).toEqual({ kick: false, crash: 16, swell: false });
  });
});
