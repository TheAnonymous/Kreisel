import { describe, expect, it } from "vitest";
import { factoryProject, technoProject, TENSION_MAX, type Piece } from "../src/model";
import { clearRoster, dicePiece, fillRoster, flipped, planBar, playsThere, resizePiece, rosterOf, ROSTER, rotatePiece, setKick, setRoster, soundPiece } from "../src/piece";
import { deserialize, pack, packPiece, serialize, unpack, unpackPiece } from "../src/codec";
import { seeded } from "../src/patterns";

/** A piece of sixteen bars at one tension (a share of the full height), the kick first to come in. */
function level(share: number, bars = 16): Piece {
  const tension = Array.from({ length: bars }, () => Math.round(share * TENSION_MAX));
  return soundPiece(true, tension, tension.map(() => 0), [0, 2, 1, 3, 4, 5, 6], 0);
}

describe("the roster: who plays in which bar, whatever the tension", () => {
  it("leaves a piece that has none exactly what it was", () => {
    const piece = level(1);
    expect(Object.keys(piece)).toEqual(["on", "tension", "scenes", "order"]);
    setRoster(piece, 2, 0, 8, ROSTER.rests);
    setRoster(piece, 2, 0, 8, ROSTER.tension);
    expect(Object.keys(piece)).toEqual(["on", "tension", "scenes", "order"]);
  });

  it("lets a ring rest although the tension has reached it", () => {
    const piece = level(1);
    setRoster(piece, 2, 0, 8, ROSTER.rests);
    expect(planBar(piece, 3).gates[2]).toBe(0);
    expect(planBar(piece, 3).gates[1]).toBeGreaterThan(0);
    expect(planBar(piece, 9).gates[2]).toBeGreaterThan(0);
    expect(rosterOf(piece, 2, 3)).toBe(ROSTER.rests);
    expect(playsThere(piece, 2, 3)).toBe(false);
    expect(playsThere(piece, 2, 9)).toBe(true);
  });

  it("lets a ring play, and in full, although the tension has not reached it", () => {
    const piece = level(0);
    expect(planBar(piece, 2).gates.every((gate) => gate === 0)).toBe(true);
    setRoster(piece, 4, 0, 8, ROSTER.plays);
    expect(planBar(piece, 2).gates[4]).toBe(1);
    expect(planBar(piece, 2).gates[0]).toBe(0);
    expect(planBar(piece, 10).gates[4]).toBe(0);
    expect(playsThere(piece, 4, 2)).toBe(true);
    // A ring that the tension has only just reached plays under its level; laid in, it plays in full.
    const low = level(0.31);
    expect(planBar(low, 0).gates[1]).toBeLessThan(0.45);
    setRoster(low, 1, 0, 16, ROSTER.plays);
    expect(planBar(low, 0).gates[1]).toBe(1);
  });

  it("keeps the kick's rest where the break always was", () => {
    const piece = level(1);
    setRoster(piece, 0, 8, 16, ROSTER.rests);
    expect(piece.noKick).toEqual([...Array.from({ length: 8 }, () => false), ...Array.from({ length: 8 }, () => true)]);
    expect(piece.roster).toBeUndefined();
    expect(rosterOf(piece, 0, 9)).toBe(ROSTER.rests);
    expect(planBar(piece, 9).gates[0]).toBe(0);
    // A break made the old way shows in the roster, and the roster takes it back.
    setKick(piece, 0, 8, false);
    expect(rosterOf(piece, 0, 2)).toBe(ROSTER.rests);
    setRoster(piece, 0, 0, 16, ROSTER.tension);
    expect(piece.noKick).toBeUndefined();
    expect(planBar(piece, 9).gates[0]).toBeGreaterThan(0);
  });

  it("lets the kick play below its tension, and a break takes that back", () => {
    const piece = level(0);
    setRoster(piece, 0, 0, 8, ROSTER.plays);
    expect(planBar(piece, 1).gates[0]).toBe(1);
    setKick(piece, 0, 8, false);
    expect(planBar(piece, 1).gates[0]).toBe(0);
    setKick(piece, 0, 8, true);
    expect(rosterOf(piece, 0, 1)).toBe(ROSTER.tension);
    expect(piece.roster).toBeUndefined();
  });

  it("lands when a kick that was laid in comes back from a break", () => {
    const piece = level(0);
    setRoster(piece, 0, 8, 16, ROSTER.plays);
    setKick(piece, 0, 8, false);
    expect(planBar(piece, 7).rise).toBe(true);
    expect(planBar(piece, 6).rise).toBe(false);
  });

  it("plays no roll on a snare that is laid out, and the fills go by who plays", () => {
    const tension = [...Array.from({ length: 8 }, () => 6), ...Array.from({ length: 8 }, () => TENSION_MAX)];
    const piece = soundPiece(true, tension, tension.map(() => 0), [0, 2, 1, 3, 4, 5, 6], 0, { runUp: { roll: true }, vary: true });
    // Two bars before the landing the roll is at its first stage, right before it at its second.
    expect([planBar(piece, 6).roll, planBar(piece, 7).roll]).toEqual([1, 2]);
    setRoster(piece, 1, 0, 8, ROSTER.rests);
    expect([planBar(piece, 6).roll, planBar(piece, 7).roll]).toEqual([0, 0]);
    // A fill is a kick more at the end of the phrase: it needs the kick's gate, which a kick laid out does not have.
    expect(planBar(piece, 15).vary).toBeGreaterThan(0);
    setRoster(piece, 0, 8, 16, ROSTER.rests);
    expect(planBar(piece, 15).gates[0]).toBe(0);
  });

  it("turns a click into the plainest state that changes whether the ring plays", () => {
    const high = level(1);
    // It plays by the tension: a click lets it rest; another gives it back to the tension.
    expect(flipped(high, 3, 0)).toBe(ROSTER.rests);
    setRoster(high, 3, 0, 8, ROSTER.rests);
    expect(flipped(high, 3, 0)).toBe(ROSTER.tension);
    const low = level(0);
    // The tension has not reached it: a click lays it in; another gives it back.
    expect(flipped(low, 3, 0)).toBe(ROSTER.plays);
    setRoster(low, 3, 0, 8, ROSTER.plays);
    expect(flipped(low, 3, 0)).toBe(ROSTER.tension);
    // Laid in where the tension would let it play anyway: a click lets it rest.
    setRoster(high, 3, 0, 8, ROSTER.plays);
    expect(flipped(high, 3, 0)).toBe(ROSTER.rests);
    // Laid out where the tension would not let it play: a click lays it in.
    setRoster(low, 3, 0, 8, ROSTER.rests);
    expect(flipped(low, 3, 0)).toBe(ROSTER.plays);
  });

  it("fills a stretch with every ring, and gives a stretch back to the tension", () => {
    const piece = level(0);
    setKick(piece, 0, 16, false);
    fillRoster(piece, 0, 8);
    expect(planBar(piece, 3).gates).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(planBar(piece, 12).gates).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(piece.noKick?.slice(0, 8).some(Boolean)).toBe(false);
    expect(piece.noKick?.slice(8).every(Boolean)).toBe(true);
    clearRoster(piece, 0, 16);
    expect(Object.keys(piece)).toEqual(["on", "tension", "scenes", "order"]);
  });

  it("stretches with the piece, turns with it, and goes with a line that is diced anew", () => {
    const piece = level(1);
    setRoster(piece, 5, 8, 16, ROSTER.rests);
    resizePiece(piece, 32);
    expect(piece.roster?.[5]?.slice(0, 16).every((state) => state === 0)).toBe(true);
    expect(piece.roster?.[5]?.slice(16).every((state) => state === ROSTER.rests)).toBe(true);
    rotatePiece(piece, 4);
    expect(rosterOf(piece, 5, 19)).toBe(ROSTER.tension);
    expect(rosterOf(piece, 5, 20)).toBe(ROSTER.rests);
    expect(rosterOf(piece, 5, 3)).toBe(ROSTER.rests);
    dicePiece(piece, seeded(7), "frei");
    expect(piece.roster).toBeUndefined();
    setRoster(piece, 5, 0, 8, ROSTER.plays);
    dicePiece(piece, seeded(7), "techno");
    expect(piece.roster).toBeUndefined();
  });

  it("has a list only for a ring that has something laid", () => {
    const piece = level(1);
    setRoster(piece, 6, 0, 8, ROSTER.rests);
    expect(piece.roster?.map((list) => list.length)).toEqual([0, 0, 0, 0, 0, 0, 16]);
  });
});

describe("the roster in a link and in the browser's memory", () => {
  it("comes back as it was laid", () => {
    const project = technoProject();
    setRoster(project.piece, 4, 8, 16, ROSTER.plays);
    setRoster(project.piece, 1, 48, 56, ROSTER.rests);
    setRoster(project.piece, 0, 0, 8, ROSTER.plays);
    expect(unpack(pack(project))).toEqual(project);
    expect(deserialize(serialize(project))).toEqual(project);
  });

  it("costs nothing in a link while nothing is laid, and comes last when something is", () => {
    const plain = factoryProject().piece;
    expect(packPiece(plain)).toHaveLength(3);
    const techno = technoProject().piece;
    const before = packPiece(techno);
    expect(before).toHaveLength(4);
    setRoster(techno, 2, 64, 72, ROSTER.rests);
    const packed = packPiece(techno);
    expect(packed).toHaveLength(6);
    expect(packed.slice(0, 4)).toEqual(before);
    expect(packed[4]).toBe(0);
    expect(packed[5]).toEqual(["", "", expect.stringMatching(/^[\w-]+$/)]);
    // A plain piece with a roster keeps the two places before it, empty.
    setRoster(plain, 6, 0, 8, ROSTER.plays);
    expect(packPiece(plain).slice(3, 5)).toEqual(["", 0]);
  });

  it("reads a link from before as it always did", () => {
    const techno = technoProject().piece;
    expect(unpackPiece(packPiece(techno), 0)).toEqual(techno);
    expect(unpackPiece([1, packPiece(techno)[1], "0213456"], 0).roster).toBeUndefined();
  });

  it("does not take from a link what is not a roster", () => {
    const techno = technoProject().piece;
    const packed = [...packPiece(techno)] as unknown[];
    const read = (lists: unknown): Piece => unpackPiece([packed[0], packed[1], packed[2], packed[3], 0, lists], 0);
    expect(read("nonsense").roster).toBeUndefined();
    expect(read([17, null, { length: 4 }]).roster).toBeUndefined();
    expect(read(["", "%%%"]).roster).toBeUndefined();
    expect(read(["", "A".repeat(400)]).roster).toBeUndefined();
    // Three is no state; more lists than rings are not read; a list is as long as the piece, whatever the link says.
    expect(read(["", "_w", "", "", "", "", "", "VQ"]).roster).toBeUndefined();
    const some = read(["", "Vg"]);
    expect(some.roster?.[1]?.slice(0, 5)).toEqual([2, 1, 1, 1, 0]);
    expect(some.roster?.[1]).toHaveLength(techno.tension.length);
    // A kick that a link lays out is a break.
    const kick = read(["qg"]);
    expect(kick.noKick?.slice(0, 4)).toEqual([true, true, true, true]);
    expect(kick.roster?.[0] ?? []).toEqual([]);
  });
});
