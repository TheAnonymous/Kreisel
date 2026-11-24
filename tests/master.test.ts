import { describe, expect, it } from "vitest";
import { packPiece, serialize, deserialize, unpackPiece } from "../src/codec";
import { BAR, clone, currentScene, MARK, masterPiece, TECHNO_ORDER, technoPiece, technoProject, TENSION_MAX, TRACK_COUNT, type Build, type Piece } from "../src/model";
import { barCount, buildAt, buildFor, describePiece, dropsOf, PHRASE, planBar, protocolLines, tidyPiece } from "../src/piece";
import { hasWeather, tideShare } from "../src/weather";
import { isOpenHat } from "../src/hat";

/*
 * The piece the techno Kreisel comes with is an example of working with
 * tension: every means the piece has is in it once, where it has a reason.
 * These tests hold the arc, so that it stays what it was built to be.
 */

const KICK = 0;
const CLAP = 1;
const HAT = 2;
const DRUM = 3;
const BASS = 4;
const STAB = 5;
/** The six rings that have hits in the techno Kreisel (the melody's ring is empty). */
const SOUNDING = [KICK, CLAP, HAT, DRUM, BASS, STAB];

const piece = masterPiece();
/** Who plays in a bar (counted from 0), of the six rings that have hits. */
const playing = (bar: number, of: Piece = piece): number[] => SOUNDING.filter((ring) => (planBar(of, bar).gates[ring] ?? 0) > 0);
/** Who plays all through phrase `phrase` (counted from 1). */
const lineup = (phrase: number): number[] => SOUNDING.filter((ring) => Array.from({ length: PHRASE }, (_, at) => (phrase - 1) * PHRASE + at).every((bar) => playing(bar).includes(ring)));
const share = (bar: number): number => (piece.tension[bar] ?? 0) / TENSION_MAX;

describe("the techno Kreisel's own piece", () => {
  it("is a track of 160 bars, a little over four minutes, that waits switched off", () => {
    expect([barCount(piece), piece.on, piece.scenes.every((scene) => scene === 0)]).toEqual([160, false, true]);
    expect(describePiece(piece, 150)).toMatch(/^160 bars, 4:16 minutes, \d+ % tension on average, 24 bars of break$/);
    expect(piece.tension.every((value) => Number.isInteger(value) && value >= 0 && value <= TENSION_MAX)).toBe(true);
  });

  it("is as plain as a piece is kept: tidying changes nothing, and a link carries all of it", () => {
    const tidy = clone(piece);
    tidyPiece(tidy);
    expect(tidy).toEqual(piece);
    expect(unpackPiece(JSON.parse(JSON.stringify(packPiece(piece))), 0)).toEqual(piece);
    const project = technoProject();
    expect(deserialize(serialize(project))).toEqual(project);
  });

  it("brings the rings in one at a phrase: kick, hi-hat, the tuned drum, the acid line", () => {
    expect([1, 2, 3, 4].map(lineup)).toEqual([[KICK], [KICK, HAT], [KICK, HAT, DRUM], [KICK, HAT, DRUM, BASS]]);
    // The acid line fades in by the tension alone: there from the first bar of its phrase, and not yet in full.
    expect(playing(24)).toEqual([KICK, HAT, DRUM, BASS]);
    expect(planBar(piece, 24).gates[BASS]).toBeLessThan(0.45);
    expect(planBar(piece, 31).gates[BASS]).toBeGreaterThan(planBar(piece, 24).gates[BASS] ?? 1);
    expect(piece.roster?.[BASS]).toEqual([]);
  });

  it("has four drops, each with a build-up of its own, and no two are alike", () => {
    expect(dropsOf(piece)).toEqual([32, 72, 120, 128]);
    const kits = dropsOf(piece).map((bar) => buildFor(piece, bar));
    expect(kits.map((kit) => kit.bars)).toEqual([2, 4, 8, 2]);
    expect(new Set(kits.map((kit) => JSON.stringify(kit))).size).toBe(4);
    // Between them the four use every part a build-up has.
    const parts: (keyof Build)[] = ["roll", "lows", "wash", "dip", "kick", "hat", "late"];
    for (const part of parts) expect(kits.some((kit) => kit[part] === true), part).toBe(true);
    expect([kits.some((kit) => kit.riser === 1), kits.some((kit) => kit.riser === 2), kits.some((kit) => kit.gap > 0)]).toEqual([true, true, true]);
    // The big one leads out of the long break, and ends in half a bar of nothing.
    expect(kits[2]).toMatchObject({ bars: 8, riser: 2, roll: true, lows: true, wash: true, dip: true, gap: 2 });
    // Every build-up has room for its whole length.
    for (const bar of dropsOf(piece)) expect(buildAt(piece, bar - buildFor(piece, bar).bars)).toMatchObject({ drop: bar, at: 0 });
  });

  it("keeps the clap for the first drop, and at the half of the first full section the tuned drum hands over to the stab", () => {
    expect([5, 6, 7].map(lineup)).toEqual([[KICK, CLAP, HAT, DRUM, BASS], [KICK, CLAP, HAT, DRUM, BASS], [KICK, CLAP, HAT, BASS, STAB]]);
    // A roll needs the snare's ring: where one runs, the clap is not laid out.
    for (const bar of [30, 31, 68, 69, 70, 71, 112, 119, 126, 127]) expect(planBar(piece, bar).roll, `bar ${bar + 1}`).toBe(true);
  });

  it("takes the hi-hat away before the first break, and gives it back in the break while the kick is gone", () => {
    expect(lineup(8)).toEqual([KICK, CLAP, BASS, STAB]);
    // The short break: clap, hi-hat and the acid line play on. Its last bar is the build-up's, without the hi-hat.
    expect([64, 65, 66, 67, 68, 69, 70].map((bar) => playing(bar))).toEqual(Array.from({ length: 7 }, () => [CLAP, HAT, BASS]));
    expect(playing(71)).toEqual([CLAP, BASS]);
    expect(piece.noKick?.flatMap((out, bar) => (out ? [bar] : []))).toEqual([...Array.from({ length: 8 }, (_, at) => 64 + at), ...Array.from({ length: 16 }, (_, at) => 104 + at)]);
  });

  it("plays the second full section with the stab and without the tuned drum, then strips it to its core and cools down", () => {
    const second = [KICK, CLAP, HAT, BASS, STAB];
    expect([10, 11, 12, 13].map(lineup)).toEqual([second, second, [KICK, CLAP, HAT, BASS], [KICK, HAT, BASS]]);
    // It stands higher than the first, and its second half a step higher still: a small change over a long stretch.
    expect(share(72)).toBeGreaterThan(share(32));
    expect(share(87)).toBeGreaterThan(share(72));
    expect(share(87) - share(72)).toBeLessThan(0.05);
    // The line sinks through the cool-down.
    expect(share(103)).toBeLessThan(share(96));
  });

  it("goes through the long break in two stages: first only stab and hi-hat, then the acid line comes back under the big build-up", () => {
    expect(lineup(14)).toEqual([HAT, STAB]);
    expect(lineup(15)).toEqual([HAT, BASS, STAB]);
    // The long break is the lowest point between the intro and the outro.
    const low = Math.min(...piece.tension.slice(32, 144));
    expect(piece.tension.slice(104, 112).every((value) => value === low || value === low + 1)).toBe(true);
    expect(piece.tension.slice(64, 72).every((value) => value > low + 1)).toBe(true);
  });

  it("lands the big drop as an anti-drop, only kick and acid line, and brings everything eight bars later at the very top", () => {
    expect(lineup(16)).toEqual([BASS]);
    expect([120, 125, 126].map((bar) => playing(bar))).toEqual([[KICK, BASS], [KICK, BASS], [KICK, CLAP, BASS]]);
    // The last bar before the top is without the kick.
    expect(playing(127)).toEqual([CLAP, BASS]);
    expect([17, 18].map(lineup)).toEqual([SOUNDING, SOUNDING]);
    // Only at the top do all six play together: the tuned drum has been away for eighty bars.
    for (let phrase = 1; phrase <= 16; phrase += 1) expect(lineup(phrase), `phrase ${phrase}`).not.toEqual(SOUNDING);
    expect(Array.from({ length: 80 }, (_, at) => 48 + at).some((bar) => playing(bar).includes(DRUM))).toBe(false);
    expect(piece.tension.slice(128, 144).every((value) => value === TENSION_MAX)).toBe(true);
    // Nowhere else is the line at the top: every full section stands higher than the one before.
    expect(piece.tension.filter((value) => value === TENSION_MAX)).toHaveLength(16);
  });

  it("is taken apart by the line alone, in the order the rings came, and closes into its first bar", () => {
    expect(piece.roster?.every((list) => list.slice(144).every((state) => state === 0))).toBe(true);
    const left = (ring: number): number => Array.from({ length: 16 }, (_, at) => 144 + at).find((bar) => !playing(bar).includes(ring)) ?? 160;
    expect([STAB, CLAP, BASS, DRUM, HAT].map(left)).toEqual([...[STAB, CLAP, BASS, DRUM, HAT].map(left)].sort((one, other) => one - other));
    expect(left(HAT)).toBeLessThan(160);
    expect(left(KICK)).toBe(160);
    expect(playing(159)).toEqual([KICK]);
    expect(planBar(piece, 159).rise).toBe(false);
    expect(Math.abs((piece.tension[159] ?? 0) - (piece.tension[0] ?? 0))).toBeLessThanOrEqual(1);
  });

  it("changes who plays only where a phrase begins, a build-up's last bars and the outro aside", () => {
    for (let bar = 1; bar < 144; bar += 1) {
      if (bar % PHRASE === 0) continue;
      const build = planBar(piece, bar).build ?? planBar(piece, bar - 1).build;
      if (build) continue;
      expect(playing(bar), `bar ${bar + 1}`).toEqual(playing(bar - 1));
    }
  });

  it("lets the tension move the sound in all six ways", () => {
    expect(piece.sway).toEqual({ hat: 2, bright: 2, kick: 1, dense: 2, drive: 1, room: 1 });
    // The quiet hits fall away in the intro, in both breaks and in the outro, and never in a full section or the anti-drop.
    const thin = (bar: number): boolean => planBar(piece, bar).sway?.thin === true;
    expect([0, 31, 64, 71, 104, 119, 159].every(thin)).toBe(true);
    expect([32, 63, 72, 95, 120, 127, 128, 143].some(thin)).toBe(false);
  });

  it("marks the ends of its phrases: fills, a crash every sixteen bars, a cymbal backwards into each", () => {
    expect([piece.vary, piece.ends]).toEqual([true, { kick: false, crash: 16, swell: true }]);
    // The two drops that land on such a bar bring their own crash.
    expect([0, 16, 48, 64, 80, 96, 112, 144].every((bar) => planBar(piece, bar).crash)).toBe(true);
    expect([32, 128].some((bar) => planBar(piece, bar).crash)).toBe(false);
  });

  it("lays seven effects, each of the five at least once, each on the last bar of a phrase", () => {
    expect(piece.marks).toEqual([
      { bar: 15, fx: MARK.pause },
      { bar: 47, fx: MARK.stotter },
      { bar: 55, fx: MARK.echo },
      { bar: 87, fx: MARK.duenn },
      { bar: 95, fx: MARK.pause },
      { bar: 111, fx: MARK.dumpf },
      { bar: 143, fx: MARK.echo },
    ]);
    for (const mark of piece.marks ?? []) {
      expect(mark.bar % PHRASE).toBe(PHRASE - 1);
      // Never where a build-up runs: that bar has enough going on.
      expect(planBar(piece, mark.bar).build).toBeNull();
    }
  });

  it("can be read as a protocol", () => {
    const names = ["Kick", "Clap", "Hi-Hat", "Drum", "Bass", "Chords", "Melody"];
    const lines = protocolLines(piece, names);
    expect(lines).toHaveLength(20);
    expect(lines[0]).toBe("Bars 1–8: Kick");
    expect(lines[4]).toBe("Bars 33–40: Kick, Clap, Hi-Hat, Drum, Bass · Drop in bar 33");
    // The melody's ring is empty in the techno Kreisel; whoever paints one hears it in the second full section and at the top.
    expect(lines[6]).toBe("Bars 49–56: Kick, Clap, Hi-Hat, Bass, Chords");
    expect(lines[9]).toBe("Bars 73–80: Kick, Clap, Hi-Hat, Bass, Chords, Melody · Drop in bar 73");
    expect(lines[11]).toBe("Bars 89–96: Kick, Clap, Hi-Hat, Bass");
    expect(lines[8]).toBe("Bars 65–72: Clap, Hi-Hat (partly), Bass · Break · Build-up");
    expect(lines[13]).toBe("Bars 105–112: Hi-Hat, Chords · Break");
    expect(lines[15]).toBe("Bars 121–128: Kick (partly), Clap (partly), Bass · Build-up · Drop in bar 121");
    expect(lines[16]).toBe("Bars 129–136: all · Drop in bar 129");
  });
});

describe("the techno Kreisel's scene", () => {
  const scene = currentScene(technoProject());

  it("has two tides in lengths of their own: rain on the stab over twelve bars, sun on the hi-hat over twenty", () => {
    expect(scene.tide).toEqual([0, 20, 0, 12, 0, 0]);
    expect(scene.wind.every((wind) => wind === 0)).toBe(true);
    const lies = Array.from({ length: 6 }, (_, kind) => Array.from({ length: TRACK_COUNT }, (_, ring) => ring).filter((ring) => hasWeather(scene, kind, ring)));
    expect(lies).toEqual([[], [HAT], [], [STAB], [], []]);
    // The rain lies where the stab strikes, the sun on every open hit of the hi-hat.
    const stab = scene.patterns[STAB]!;
    for (let step = 0; step < stab.len; step += 1) if (stab.steps[step]?.on) expect(scene.weather[3]?.[STAB]?.[step]).toBeGreaterThan(0);
    const hat = scene.patterns[HAT]!;
    for (let step = 0; step < hat.len; step += 1) if (hat.steps[step]?.on && isOpenHat(hat.steps[step]?.pitch ?? 0)) expect(scene.weather[1]?.[HAT]?.[step]).toBeGreaterThan(0);
  });

  it("has both tides at nothing where the piece's big drop lands, and the rain at its fullest in the build-up before", () => {
    const at = (bar: number, kind: number): number => tideShare(bar * BAR, scene.tide?.[kind] ?? 0);
    expect([at(120, 1), at(120, 3)]).toEqual([0, 0]);
    expect(at(114, 3)).toBeCloseTo(1, 6);
  });
});

describe("the plain techno form", () => {
  it("is what an empty techno Kreisel starts with: 112 bars, one break, nothing laid", () => {
    const plain = technoPiece();
    expect([barCount(plain), plain.order, plain.roster, plain.sway, plain.ends, plain.marks, plain.vary]).toEqual([112, [...TECHNO_ORDER], undefined, undefined, undefined, undefined, undefined]);
    expect(dropsOf(plain)).toEqual([16, 64]);
  });
});
