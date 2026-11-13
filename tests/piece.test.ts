import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, pack, packPiece, unpack, unpackPiece } from "../src/codec";
import { factoryProject, FIRST_ORDER, firstPiece, MAX_BARS, MIN_BARS, TENSION_MAX, TRACK_COUNT, type Piece } from "../src/model";
import { seeded } from "../src/patterns";
import { barCount, cutoffFor, describePiece, dicePiece, dropsQuiet, entry, gateLevel, moveInOrder, planBar, resizePiece, rotatePiece, smoothPiece, soundPiece, STEEP } from "../src/piece";

const piece = (tension: number[], order: number[] = [...FIRST_ORDER]): Piece => ({ on: true, tension, scenes: tension.map(() => 0), order });
const playing = (plan: { gates: number[] }): number[] => plan.gates.map((gate, ring) => (gate > 0 ? ring : -1)).filter((ring) => ring >= 0);

describe("who plays", () => {
  it("lets the rings come in one after another, in the piece's order", () => {
    const heights = Array.from({ length: TENSION_MAX + 1 }, (_, tension) => tension);
    const counts = heights.map((tension) => playing(planBar(piece([tension, tension]), 0)).length);
    expect(counts[0]).toBe(0);
    expect(counts[TENSION_MAX]).toBe(TRACK_COUNT);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts);
    expect(new Set(counts).size).toBe(TRACK_COUNT + 1);
    // The first of the order plays as soon as there is any tension worth the name.
    expect(playing(planBar(piece([2, 2]), 0))).toEqual([FIRST_ORDER[0]]);
    expect(playing(planBar(piece([2, 2], [3, 0, 1, 2, 4, 5, 6]), 0))).toEqual([3]);
    for (let place = 1; place < TRACK_COUNT; place += 1) expect(entry(place)).toBeGreaterThan(entry(place - 1));
    expect(entry(TRACK_COUNT - 1)).toBeLessThan(1);
  });

  it("brings a ring in gently: quieter and without its quiet steps", () => {
    const fresh = planBar(piece([2, 2]), 0).gates[FIRST_ORDER[0]]!;
    const settled = planBar(piece([TENSION_MAX, TENSION_MAX]), 0).gates[FIRST_ORDER[0]]!;
    expect(dropsQuiet(fresh)).toBe(true);
    expect(dropsQuiet(settled)).toBe(false);
    expect(gateLevel(fresh)).toBeLessThan(gateLevel(settled));
    expect(gateLevel(settled)).toBe(1);
  });

  it("changes the order of coming in", () => {
    const one = piece([2, 2]);
    moveInOrder(one, 0, -1);
    expect(one.order).toEqual([5, 2, 0, 4, 1, 6, 3]);
    moveInOrder(one, 5, -1);
    moveInOrder(one, 3, 1);
    moveInOrder(one, 9, 1);
    expect(one.order).toEqual([5, 2, 0, 4, 1, 6, 3]);
    moveInOrder(one, 3, -1);
    expect(one.order).toEqual([5, 2, 0, 4, 1, 3, 6]);
  });
});

describe("the sound and the steps", () => {
  it("opens the sound as the tension rises", () => {
    expect(cutoffFor(0)).toBeCloseTo(900);
    expect(cutoffFor(1)).toBe(20_000);
    expect(cutoffFor(0.62)).toBe(20_000);
    for (let tension = 0.05; tension <= 1; tension += 0.05) expect(cutoffFor(tension)).toBeGreaterThanOrEqual(cutoffFor(tension - 0.05));
  });

  it("opens through a bar towards a higher one, and closes only when the lower bar begins", () => {
    const up = planBar(piece([6, 31]), 0);
    expect(up.cutoffEnd).toBe(20_000);
    expect(up.cutoff).toBeLessThan(6000);
    const down = planBar(piece([31, 6]), 0);
    expect(down.cutoff).toBe(20_000);
    expect(down.cutoffEnd).toBe(20_000);
  });

  it("takes a run-up before a steep rise and throws the echo before a steep fall", () => {
    const step = Math.ceil(STEEP * TENSION_MAX);
    expect(planBar(piece([10, 10 + step]), 0)).toMatchObject({ rise: true, fall: false });
    expect(planBar(piece([10, 10 + step - 2]), 0).rise).toBe(false);
    // A small step up near the bottom is no landing worth a run-up.
    expect(planBar(piece([0, step]), 0).rise).toBe(false);
    expect(planBar(piece([25, 25 - step]), 0)).toMatchObject({ rise: false, fall: true });
    // The piece is a ring: the last bar looks at the first.
    expect(planBar(piece([31, 20, 4]), 2).rise).toBe(true);
    expect(planBar(piece([4, 20, 31]), 2).fall).toBe(true);
  });

  it("plays the scene laid on the bar", () => {
    const two = piece([10, 10, 10, 10]);
    two.scenes = [0, 0, 3, 3];
    expect([0, 1, 2, 3, 4].map((bar) => planBar(two, bar).scene)).toEqual([0, 0, 3, 3, 0]);
  });
});

describe("shaping the piece", () => {
  it("stretches instead of cutting when its length changes", () => {
    const one = piece([1, 9, 20, 31]);
    one.scenes = [0, 0, 2, 2];
    resizePiece(one, 8);
    expect(one.tension).toEqual([1, 1, 9, 9, 20, 20, 31, 31]);
    expect(one.scenes).toEqual([0, 0, 0, 0, 2, 2, 2, 2]);
    resizePiece(one, 4);
    expect(one.tension).toEqual([1, 9, 20, 31]);
    resizePiece(one, 1);
    expect(barCount(one)).toBe(MIN_BARS);
    resizePiece(one, 999);
    expect(barCount(one)).toBe(MAX_BARS);
    expect(one.tension[0]).toBe(1);
    expect(one.tension[MAX_BARS - 1]).toBe(31);
  });

  it("turns, with its scenes", () => {
    const one = piece([1, 2, 3, 4]);
    one.scenes = [0, 0, 1, 1];
    rotatePiece(one, 1);
    expect(one.tension).toEqual([4, 1, 2, 3]);
    expect(one.scenes).toEqual([1, 0, 0, 1]);
    rotatePiece(one, -1);
    rotatePiece(one, 8);
    expect(one.tension).toEqual([1, 2, 3, 4]);
  });

  it("softens steep steps when smoothed", () => {
    const one = piece([0, 0, 0, 0, 31, 31, 31, 31]);
    smoothPiece(one);
    expect(one.tension).toEqual([8, 0, 0, 8, 23, 31, 31, 23]);
    const steepest = (values: number[]): number => Math.max(...values.map((value, index) => Math.abs(value - (values[(index + 1) % values.length] ?? 0))));
    expect(steepest(one.tension)).toBeLessThan(31);
  });

  it("dices a line that moves, the same for the same seed, whatever the length", () => {
    for (const bars of [4, 16, 32, 100, MAX_BARS]) {
      for (let seed = 1; seed <= 20; seed += 1) {
        const one = piece(Array.from({ length: bars }, () => 0));
        one.scenes = one.tension.map((_, bar) => bar % 2);
        dicePiece(one, seeded(seed));
        expect(one.tension).toHaveLength(bars);
        for (const tension of one.tension) {
          expect(tension).toBeGreaterThanOrEqual(0);
          expect(tension).toBeLessThanOrEqual(TENSION_MAX);
        }
        expect(Math.max(...one.tension)).toBeGreaterThan(8);
        if (bars >= 16) expect(Math.max(...one.tension) - Math.min(...one.tension)).toBeGreaterThan(10);
        // The scenes are not the dice's business.
        expect(one.scenes).toEqual(one.tension.map((_, bar) => bar % 2));
        const again = piece(Array.from({ length: bars }, () => 0));
        dicePiece(again, seeded(seed));
        expect(again.tension).toEqual(one.tension);
      }
    }
  });

  it("says how long it is", () => {
    expect(describePiece(piece(Array.from({ length: 32 }, () => 31)), 120)).toBe("32 Takte, 1:04 Minuten, im Mittel 100 % Spannung");
    expect(describePiece(piece([0, 0, 0, 31]), 60)).toBe("4 Takte, 0:16 Minuten, im Mittel 25 % Spannung");
  });
});

describe("a piece in a link", () => {
  it("round-trips, alone and in a project", async () => {
    const one = firstPiece();
    one.on = true;
    one.scenes = one.scenes.map((_, bar) => (bar >= 16 ? 5 : 0));
    one.order = [6, 5, 4, 3, 2, 1, 0];
    expect(unpackPiece(packPiece(one), 0)).toEqual(one);
    const project = factoryProject();
    project.scenes[5] = project.scenes[0] ?? null;
    project.piece = one;
    expect(unpack(JSON.parse(JSON.stringify(pack(project))))).toEqual(JSON.parse(JSON.stringify(project)));
    expect(await decodeLink(await encodeLink(project))).toEqual(JSON.parse(JSON.stringify(project)));
    const long = factoryProject();
    resizePiece(long.piece, MAX_BARS);
    dicePiece(long.piece, seeded(3));
    expect((await encodeLink(long)).length).toBeLessThan(1000);
  });

  it("waits switched off in a project that never had one", () => {
    const old = pack(factoryProject()) as unknown as Record<string, unknown>;
    delete old.z;
    expect(unpack(old).piece).toEqual(firstPiece());
  });

  it("is put right when a link claims nonsense", () => {
    expect(unpackPiece(undefined, 2)).toEqual(firstPiece(2));
    expect(unpackPiece([1, "%%%", "0123456"], 0)).toEqual(firstPiece());
    expect(unpackPiece([1, "", "0123456"], 0)).toEqual(firstPiece());
    // Two bars only, a ring twice in the order.
    const short = unpackPiece([1, btoa(String.fromCharCode(31, 31)), "0012345"], 0);
    expect(barCount(short)).toBe(MIN_BARS);
    expect(short.order).toEqual([...FIRST_ORDER]);
    expect(short.on).toBe(true);
    const wild = soundPiece(true, Array.from({ length: 500 }, () => 99), Array.from({ length: 500 }, () => 12), [6, 5, 4, 3, 2, 1, 0], 1);
    expect(barCount(wild)).toBe(MAX_BARS);
    expect(new Set(wild.tension)).toEqual(new Set([TENSION_MAX]));
    expect(new Set(wild.scenes)).toEqual(new Set([1]));
    expect(wild.order).toEqual([6, 5, 4, 3, 2, 1, 0]);
    // A bar cannot play a scene the project does not have.
    const project = pack(factoryProject()) as unknown as { z: unknown };
    const bars = firstPiece();
    bars.scenes = bars.scenes.map(() => 4);
    project.z = packPiece(bars);
    expect(new Set(unpack(project).piece.scenes)).toEqual(new Set([0]));
  });
});
