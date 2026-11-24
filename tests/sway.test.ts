import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, packPiece, unpackPiece } from "../src/codec";
import { firstPiece, technoPiece, technoProject, TENSION_MAX, TECHNO_ORDER, type Piece } from "../src/model";
import { planBar, setBuild, setRoster, setSway, soundPiece, soundSway, swayAt, swayCount, ROSTER, tidyPiece } from "../src/piece";
import { BUILD_MEDIUM } from "../src/model";

const level = (tension: number, bars = 8): Piece => ({ on: true, tension: Array.from({ length: bars }, () => tension), scenes: Array.from({ length: bars }, () => 0), order: [...TECHNO_ORDER] });
const ALL = { hat: 2, bright: 2, kick: 2, dense: 2, drive: 2, room: 2 };

describe("what the tension moves", () => {
  it("moves nothing more unless the piece says so", () => {
    expect(planBar(level(TENSION_MAX), 0).sway).toBeNull();
    expect(planBar(technoPiece(), 20).sway).toBeNull();
    expect(swayCount(technoPiece())).toBe(0);
  });

  it("opens the hi-hat and the brightness with the tension, and takes from the kick where little is going on", () => {
    const low = swayAt(ALL, 0);
    const top = swayAt(ALL, 1);
    // At the bottom the sounds are what their rings are set to; the kick is at its smallest.
    expect([low.hat, low.bright]).toEqual([0, 0]);
    expect(low.kick).toBeGreaterThan(0.5);
    // At the top hi-hat and brightness are pushed furthest, and the kick is whole.
    expect(top.hat).toBeGreaterThan(0.5);
    expect(top.bright).toBeGreaterThan(0.5);
    expect(top.kick).toBe(0);
    // Halfway it is halfway.
    const half = swayAt(ALL, 0.5);
    expect(half.hat).toBeCloseTo(top.hat / 2);
    expect(half.kick).toBeCloseTo(low.kick / 2);
    // Gently is less than clearly, and off is nothing.
    const gentle = swayAt({ hat: 1, bright: 1, kick: 1, dense: 1, drive: 1, room: 1 }, 1);
    expect(gentle.hat).toBeGreaterThan(0);
    expect(gentle.hat).toBeLessThan(top.hat);
    expect(gentle.bright).toBeLessThan(top.bright);
    expect(swayAt({ hat: 0, bright: 0, kick: 0, dense: 0, drive: 0, room: 0 }, 0.3)).toEqual({ hat: 0, bright: 0, kick: 0, thin: false, drive: 0, room: 0 });
  });

  it("lets the quiet hits fall away where little is going on, drives harder only towards the top, and gives more room below", () => {
    expect([0.2, 0.5, 0.8].map((tension) => swayAt({ ...ALL, dense: 1 }, tension).thin)).toEqual([true, false, false]);
    expect([0.2, 0.5, 0.8].map((tension) => swayAt({ ...ALL, dense: 2 }, tension).thin)).toEqual([true, true, false]);
    expect(swayAt({ ...ALL, dense: 0 }, 0).thin).toBe(false);
    expect([0, 0.5].map((tension) => swayAt(ALL, tension).drive)).toEqual([0, 0]);
    expect(swayAt(ALL, 0.75).drive).toBeCloseTo(swayAt(ALL, 1).drive / 2);
    expect(swayAt(ALL, 1).drive).toBeGreaterThan(0.3);
    expect(swayAt(ALL, 1).room).toBe(0);
    expect(swayAt(ALL, 0).room).toBeGreaterThan(swayAt(ALL, 0.5).room);
    // Whatever a tension out of range would ask for is what its end asks for.
    expect(swayAt(ALL, 7)).toEqual(swayAt(ALL, 1));
    expect(swayAt(ALL, -1)).toEqual(swayAt(ALL, 0));
  });

  it("is in a bar's plan by that bar's tension, whoever plays there", () => {
    const line = level(TENSION_MAX);
    line.tension[0] = 0;
    setSway(line, "hat", 2);
    setSway(line, "kick", 1);
    expect(line.sway).toEqual({ hat: 2, bright: 0, kick: 1, dense: 0, drive: 0, room: 0 });
    expect(planBar(line, 0).sway).toEqual(swayAt(line.sway!, 0));
    expect(planBar(line, 3).sway).toEqual(swayAt(line.sway!, 1));
    // A ring laid in at the bottom is moved by the tension there like any other.
    setRoster(line, 2, 0, 8, ROSTER.plays);
    expect(planBar(line, 0)).toMatchObject({ sway: { hat: 0 } });
    expect(planBar(line, 0).gates[2]).toBe(1);
    expect(swayCount(line)).toBe(2);
    // Switched off again, the piece has none of it.
    setSway(line, "hat", 0);
    setSway(line, "kick", 0);
    expect(line.sway).toBeUndefined();
  });

  it("takes a claim only as far as it plainly says off, gently or clearly", () => {
    expect(soundSway({ hat: 2, bright: 1, kick: 3, dense: "viel", drive: -1, room: 1.5 })).toEqual({ hat: 2, bright: 1, kick: 0, dense: 0, drive: 0, room: 0 });
    expect([soundSway(null), soundSway("an"), soundSway({}), soundSway({ hat: 0 })]).toEqual([null, null, null, null]);
    const untidy: Piece = { ...level(10), sway: { hat: 0, bright: 0, kick: 0, dense: 0, drive: 0, room: 0 } };
    tidyPiece(untidy);
    expect(untidy.sway).toBeUndefined();
    expect(soundPiece(true, [5, 5, 5, 5], [], [], 0, { sway: { room: 2 } }).sway).toEqual({ hat: 0, bright: 0, kick: 0, dense: 0, drive: 0, room: 2 });
  });
});

describe("what the tension moves, in a link", () => {
  it("comes after the build-ups as a part of its own, costs nothing while off, and comes back as it was", async () => {
    expect(packPiece(firstPiece())).toHaveLength(3);
    expect(packPiece(technoPiece())).toHaveLength(7);
    const plain = firstPiece();
    setSway(plain, "bright", 2);
    setSway(plain, "room", 1);
    const packed = packPiece(plain);
    // The places before it are kept, empty.
    expect(packed.slice(3)).toEqual(["", 0, [], [], { s: (2 << 2) | (1 << 10) }]);
    expect(unpackPiece(JSON.parse(JSON.stringify(packed)), 0)).toEqual(plain);
    // With everything else a piece can have.
    const full = technoPiece();
    setBuild(full, null, BUILD_MEDIUM);
    setRoster(full, 2, 64, 72, ROSTER.rests);
    for (const [part, depth] of Object.entries(ALL)) setSway(full, part as keyof typeof ALL, depth);
    expect(packPiece(full)).toHaveLength(8);
    expect(unpackPiece(JSON.parse(JSON.stringify(packPiece(full))), 0)).toEqual(full);
    const project = technoProject();
    setSway(project.piece, "hat", 1);
    expect((await decodeLink(await encodeLink(project))).piece).toEqual(project.piece);
    // What a link claims beyond that is not taken.
    const seven = packPiece(technoPiece());
    for (const claim of [{ s: 0 }, { s: 1 << 12 }, { s: 2.5 }, { s: "3" }, [1], "s", null, 5]) expect(unpackPiece([...seven, claim], 0)).toEqual(technoPiece());
    // A depth of three is none.
    expect(unpackPiece([...seven, { s: 3 | (1 << 2) }], 0).sway).toEqual({ hat: 0, bright: 1, kick: 0, dense: 0, drive: 0, room: 0 });
  });
});
