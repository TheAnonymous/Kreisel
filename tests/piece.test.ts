import { describe, expect, it } from "vitest";
import { decodeLink, encodeLink, pack, packPiece, unpack, unpackPiece } from "../src/codec";
import { BAR, factoryProject, FIRST_ORDER, firstPiece, MAX_BARS, MIN_BARS, TECHNO_ORDER, technoPiece, technoProject, TENSION_MAX, TRACK_COUNT, type Piece } from "../src/model";
import { seeded } from "../src/patterns";
import { barCount, cutoffFor, describePiece, dicePiece, dropsQuiet, entry, gateLevel, kickOut, moveInOrder, PHRASE, phraseOf, planBar, resizePiece, rollHits, rotatePiece, setKick, setRunUp, setVary, smoothPiece, soundPiece, STEEP, tidyPiece, varyHits } from "../src/piece";

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

describe("a techno piece", () => {
  /** A piece in the techno order (kick, hi-hat, clap, drum, bass, chords, melody) at one height, with the given bars "ohne Kick". */
  const level = (bars: number, tension: number, out: readonly number[] = []): Piece => {
    const made: Piece = { on: true, tension: Array.from({ length: bars }, () => tension), scenes: Array.from({ length: bars }, () => 0), order: [...TECHNO_ORDER] };
    if (out.length > 0) made.noKick = made.tension.map((_, bar) => out.includes(bar));
    return made;
  };

  it("leaves the kick out of a bar that is marked so, and lets everything else play by the tension", () => {
    const line = level(16, 22, [8, 9, 10, 11]);
    // At this height everyone plays but the melody; in the marked bars the kick is not among them.
    expect(playing(planBar(line, 7))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(playing(planBar(line, 8))).toEqual([1, 2, 3, 4, 5]);
    expect(planBar(line, 8).gates.slice(1)).toEqual(planBar(line, 7).gates.slice(1));
    expect(planBar(line, 8).cutoff).toBe(planBar(line, 7).cutoff);
    expect([7, 8, 11, 12, 24].map((bar) => kickOut(line, bar))).toEqual([false, true, true, false, true]);
    // A piece without the list has no such bar.
    expect(kickOut(level(16, 22), 8)).toBe(false);
  });

  it("takes the kick's return as a landing and its leaving as a fall, without a step in the line", () => {
    const line = level(16, 22, [8, 9, 10, 11]);
    expect(planBar(line, 7)).toMatchObject({ rise: false, fall: true });
    expect(planBar(line, 9)).toMatchObject({ rise: false, fall: false });
    expect(planBar(line, 11)).toMatchObject({ rise: true, fall: false });
    expect(planBar(line, 12)).toMatchObject({ rise: false, fall: false });
    // Where the tension does not let the kick play anyway, nothing comes back and nothing leaves.
    const low = level(16, 0, [8, 9, 10, 11]);
    expect([7, 11].map((bar) => [planBar(low, bar).rise, planBar(low, bar).fall])).toEqual([[false, false], [false, false]]);
    // The piece is a ring: a break at its end lands on the first bar.
    expect(planBar(level(8, 22, [6, 7]), 7).rise).toBe(true);
  });

  it("can take more of a run-up before a landing: a roll through two bars, and the last bar without kick or hi-hat", () => {
    const line = level(16, 22, [8, 9, 10, 11]);
    expect([9, 10, 11, 12].map((bar) => planBar(line, bar).roll)).toEqual([0, 0, 0, 0]);
    setRunUp(line, "roll", true);
    expect(line.runUp).toEqual({ roll: true, kick: false, hat: false });
    expect([9, 10, 11, 12].map((bar) => planBar(line, bar).roll)).toEqual([0, 1, 2, 0]);
    // Quarters and then eighths, then eighths and then sixteenths, louder all the way.
    expect(rollHits(1).map((hit) => hit.step)).toEqual([0, 4, 8, 10, 12, 14]);
    expect(rollHits(2).map((hit) => hit.step)).toEqual([0, 2, 4, 6, 8, 9, 10, 11, 12, 13, 14, 15]);
    const levels = [...rollHits(1), ...rollHits(2)].map((hit) => hit.level);
    expect(levels.every((loud, index) => index === 0 || loud > (levels[index - 1] ?? 0))).toBe(true);
    expect([levels[0], levels.at(-1)]).toEqual([0.5, 1.2]);
    expect([rollHits(0), rollHits(3)]).toEqual([[], []]);

    // A steep rise is a landing too. Kick and hi-hat stay out of its last bar only.
    const steep = piece([10, 10, 10, 31, 31, 31, 31, 31], [...TECHNO_ORDER]);
    expect(playing(planBar(steep, 2))).toEqual([0, 1, 2]);
    setRunUp(steep, "kick", true);
    expect(playing(planBar(steep, 2))).toEqual([1, 2]);
    expect(playing(planBar(steep, 1))).toEqual([0, 1, 2]);
    setRunUp(steep, "hat", true);
    expect(playing(planBar(steep, 2))).toEqual([1]);
    expect(playing(planBar(steep, 3))).toHaveLength(TRACK_COUNT);
    setRunUp(steep, "kick", false);
    setRunUp(steep, "hat", false);
    expect(steep.runUp).toBeUndefined();
  });

  it("ends every eighth bar with a kick more and every sixteenth with the drum as well, where no run-up is going on", () => {
    const line = level(32, 31);
    expect(Array.from({ length: 32 }, (_, bar) => planBar(line, bar).vary).some((kind) => kind > 0)).toBe(false);
    setVary(line, true);
    expect(Array.from({ length: 32 }, (_, bar) => planBar(line, bar).vary)).toEqual(Array.from({ length: 32 }, (_, bar) => (bar % 16 === 15 ? 2 : bar % 8 === 7 ? 1 : 0)));
    expect(varyHits(1)).toEqual([{ ring: 0, step: 14, vel: 0, pitch: 0 }]);
    expect(varyHits(2).map((hit) => [hit.ring, hit.step])).toEqual([[0, 14], [3, 13], [3, 15]]);
    expect(varyHits(2).every((hit) => hit.step < BAR)).toBe(true);
    expect(varyHits(0)).toEqual([]);
    // The bar that runs up to a landing has enough going on.
    setKick(line, 0, 8, false);
    expect(planBar(line, 7)).toMatchObject({ rise: true, vary: 0 });
    expect(planBar(line, 15).vary).toBe(2);
    setVary(line, false);
    expect(line.vary).toBeUndefined();
  });

  it("marks and unmarks phrases of eight bars, and stays a plain piece when nothing is marked", () => {
    const line = level(20, 22);
    expect(PHRASE).toBe(8);
    expect([phraseOf(line, 0), phraseOf(line, 13), phraseOf(line, 19)]).toEqual([{ from: 0, to: 8 }, { from: 8, to: 16 }, { from: 16, to: 20 }]);
    setKick(line, 8, 16, false);
    expect(line.noKick).toEqual(Array.from({ length: 20 }, (_, bar) => bar >= 8 && bar < 16));
    setKick(line, 12, 16, true);
    expect(line.noKick?.filter(Boolean)).toHaveLength(4);
    setKick(line, 0, 99, true);
    expect(line).toEqual(level(20, 22));
    expect(Object.keys(line)).toEqual(["on", "tension", "scenes", "order"]);
    // Tidying takes away what says nothing, and brings the list to the piece's length.
    const untidy: Piece = { ...level(8, 22), noKick: [false, true], runUp: { roll: false, kick: false, hat: false }, vary: false };
    tidyPiece(untidy);
    expect(untidy.noKick).toEqual([false, true, false, false, false, false, false, false]);
    expect([untidy.runUp, untidy.vary]).toEqual([undefined, undefined]);
  });

  it("keeps its marks when it is stretched or turned, and says how many bars are without the kick", () => {
    const line = level(16, 22, [8, 9, 10, 11]);
    resizePiece(line, 32);
    expect(line.noKick).toEqual(Array.from({ length: 32 }, (_, bar) => bar >= 16 && bar < 24));
    rotatePiece(line, 4);
    expect(line.noKick).toEqual(Array.from({ length: 32 }, (_, bar) => bar >= 20 && bar < 28));
    expect(describePiece(line, 150)).toBe("32 Takte, 0:51 Minuten, im Mittel 71 % Spannung, 8 Takte Break");
    expect(describePiece(level(32, 22), 150)).toBe("32 Takte, 0:51 Minuten, im Mittel 71 % Spannung");
    resizePiece(line, 4);
    expect(barCount(line)).toBe(4);
  });

  it("dices breaks without the kick in techno, with the bass playing on, and takes the marks away with a free line", () => {
    for (const seed of [13, 7932, 15851, 23770, 31689]) {
      const line = level(112, 0);
      setRunUp(line, "roll", true);
      setVary(line, true);
      dicePiece(line, seeded(seed), "techno");
      const out = line.noKick?.flatMap((mark, bar) => (mark ? [bar] : [])) ?? [];
      // The form of 112 bars has one break of sixteen bars, after the first two full sections.
      expect(out).toEqual(Array.from({ length: 16 }, (_, index) => 48 + index));
      for (const bar of out) {
        const who = playing(planBar(line, bar));
        expect(who).not.toContain(0);
        expect(who).toEqual(expect.arrayContaining([1, 2, 3, 4]));
      }
      expect(planBar(line, 47).fall).toBe(true);
      expect(planBar(line, 63)).toMatchObject({ rise: true, roll: 2 });
      expect(planBar(line, 64).gates[0]).toBeGreaterThan(0);
      // Dice are for the line: what the piece does by itself stays as it was set.
      expect([line.runUp?.roll, line.vary]).toEqual([true, true]);
      dicePiece(line, seeded(seed));
      expect(line.noKick).toBeUndefined();
      expect([line.runUp?.roll, line.vary]).toEqual([true, true]);
    }
  });

  it("is what the techno Kreisel's own piece has: a break of sixteen bars in which the acid line plays on", () => {
    const start = technoPiece();
    expect(start.noKick?.flatMap((mark, bar) => (mark ? [bar] : []))).toEqual(Array.from({ length: 16 }, (_, index) => 48 + index));
    expect(playing(planBar(start, 48))).toEqual([1, 2, 3, 4]);
    expect(playing(planBar(start, 63))).toEqual([1, 2, 3, 4, 5]);
    expect(planBar(start, 47).fall).toBe(true);
    expect(planBar(start, 63).rise).toBe(true);
    expect([start.runUp, start.vary, start.on]).toEqual([undefined, undefined, false]);
    // The Werks-Kreisel's piece has none of it.
    expect(Object.keys(firstPiece())).toEqual(["on", "tension", "scenes", "order"]);
  });
});

describe("a piece in a link", () => {
  it("packs a piece without breaks, run-ups and Abwechslung as it always did, and carries them where it has them", async () => {
    expect(packPiece(firstPiece())).toHaveLength(3);
    const marked = technoPiece();
    expect(packPiece(marked)).toHaveLength(4);
    expect(unpackPiece(packPiece(marked), 0)).toEqual(marked);
    setRunUp(marked, "roll", true);
    setRunUp(marked, "hat", true);
    setVary(marked, true);
    const packed = packPiece(marked);
    expect(packed).toHaveLength(5);
    expect(packed[4]).toBe(1 + 4 + 8);
    expect(unpackPiece(JSON.parse(JSON.stringify(packed)), 0)).toEqual(marked);
    // Run-ups without any bar "ohne Kick": the place of the marks is kept, empty.
    const plain = firstPiece();
    setRunUp(plain, "kick", true);
    expect(packPiece(plain).slice(3)).toEqual(["", 2]);
    expect(unpackPiece(packPiece(plain), 0)).toEqual(plain);
    // In a whole Kreisel, through a link.
    const project = technoProject();
    setVary(project.piece, true);
    const back = await decodeLink(await encodeLink(project));
    expect(back.piece).toEqual(project.piece);
    expect(back.piece.noKick?.filter(Boolean)).toHaveLength(16);
    // What a link claims beyond that is not taken: marks that cannot be read, numbers that are none.
    const three = packPiece(firstPiece());
    expect(unpackPiece([...three, "%%%", 99.5], 0)).toEqual(firstPiece());
    expect(unpackPiece([...three, 7, "x"], 0)).toEqual(firstPiece());
    expect(unpackPiece([...three, "", 0], 0)).toEqual(firstPiece());
    expect(unpackPiece([...three, "", 1 + 16], 0).runUp).toEqual({ roll: true, kick: false, hat: false });
    expect(soundPiece(true, [5, 5, 5, 5], [], [], 0, { noKick: [1, "yes", true, null], runUp: { roll: 1 }, vary: "on" })).toEqual({ on: true, tension: [5, 5, 5, 5], scenes: [0, 0, 0, 0], order: [...FIRST_ORDER], noKick: [false, false, true, false] });
  });


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
